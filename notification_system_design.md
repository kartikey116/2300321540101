# Stage 1

For the campus notification platform, we need to design a solid API contract to allow the frontend client to securely fetch, update, and manage notifications. Here is the proposed REST API design.

## REST API Design & Contracts

### 1. Fetch Notifications
* **Endpoint:** `GET /api/notifications`
* **Headers:**
  * `Authorization: Bearer <token>`
  * `Content-Type: application/json`
* **Response (Status 200 OK):**
  ```json
  {
    "status": "success",
    "data": {
      "notifications": [
        {
          "id": "d146095a-0d86-4a34-9e69-3900a14576bc",
          "type": "Result",
          "message": "Semester results are out.",
          "isRead": false,
          "timestamp": "2026-06-09T12:00:00Z"
        }
      ],
      "pagination": {
        "total": 1,
        "page": 1,
        "pages": 1
      }
    }
  }
  ```

### 2. Mark Notification as Read
* **Endpoint:** `PATCH /api/notifications/:id/read`
* **Headers:**
  * `Authorization: Bearer <token>`
  * `Content-Type: application/json`
* **Response (Status 200 OK):**
  ```json
  {
    "status": "success",
    "message": "Notification marked as read"
  }
  ```

### 3. Create Notification (Admin / HR)
* **Endpoint:** `POST /api/notifications`
* **Headers:**
  * `Authorization: Bearer <token>`
  * `Content-Type: application/json`
* **Request Body:**
  ```json
  {
    "type": "Placement",
    "message": "CSX Corporation hiring drive open.",
    "studentIds": ["all"]
  }
  ```
* **Response (Status 201 Created):**
  ```json
  {
    "status": "success",
    "message": "Notification broadcast initiated successfully"
  }
  ```

---

## Real-Time Notifications Mechanism

To deliver real-time notifications efficiently, we will use **Server-Sent Events (SSE)**. 
Unlike WebSockets which are full-duplex (two-way), SSE is a lightweight, one-way push technology running over standard HTTP. Since clients only need to receive updates from the server and do not need to send message data back over the same real-time connection, SSE is much easier to implement, automatically handles reconnection, and consumes fewer server resources.

---

# Stage 2

To store notifications reliably and at scale, we need an appropriate database structure.

## Database Choice
I suggest using **PostgreSQL** (a relational SQL database).
* **Reasoning:** Notification states require strict consistency (e.g. marking a message as read must be updated reliably across devices). PostgreSQL supports ACID transactions, handles relational joins between students and notifications efficiently, and provides excellent indexing options for fast queries.

## DB Schema Design

```sql
CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    roll_number VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL, -- 'Placement', 'Result', 'Event'
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE student_notifications (
    student_id INT REFERENCES students(id) ON DELETE CASCADE,
    notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP NULL,
    PRIMARY KEY (student_id, notification_id)
);
```

## Scaling Concerns and Solutions
As data volume grows to millions of rows, the `student_notifications` table will become a bottleneck.
1. **Partitioning:** We can partition the `student_notifications` table by range of `created_at` (e.g., monthly partitions). Old notifications can be archived to lower-tier storage.
2. **Indexing:** Create composite indexes on `(student_id, is_read)` to ensure that fetching unread notifications remains extremely fast regardless of table size.
3. **Database Replication:** Set up a primary writer database and multiple read replicas. All fetch queries will target the read replicas, keeping the primary database free for fast writes.

## SQL Queries

### Fetch unread notifications for a student
```sql
SELECT n.id, n.type, n.message, sn.is_read, n.created_at
FROM student_notifications sn
JOIN notifications n ON sn.notification_id = n.id
WHERE sn.student_id = 1042 AND sn.is_read = FALSE
ORDER BY n.created_at DESC;
```

### Mark a notification as read
```sql
UPDATE student_notifications
SET is_read = TRUE, read_at = NOW()
WHERE student_id = 1042 AND notification_id = 'd146095a-0d86-4a34-9e69-3900a14576bc';
```

---

# Stage 3

## Query Analysis

Original Query:
```sql
SELECT * FROM notifications 
WHERE studentID = 1042 AND isRead = false 
ORDER BY createdAt DESC;
```

1. **Accuracy:** Assuming the developer combined student associations and notifications into a single table or column, the query is syntactically logical. However, in a normalized database schema, notifications should be joined with a mapping table (like `student_notifications`) as shown in Stage 2.
2. **Why is it slow?** With 5,000,000 rows and no index, the database engine must scan every single row (Full Table Scan) to filter rows matching `studentID = 1042` and `isRead = false`, and then sort the matching rows by `createdAt`.
3. **Likely computation cost:** $O(N)$ where $N$ is the number of notifications (5,000,000). The database reads millions of blocks from disk, leading to high I/O latency.
4. **Colleague's index advice:** Adding an index to *every* column is a bad idea. While indexes speed up read operations, they slow down write operations (INSERT, UPDATE, DELETE) because the database has to update the indexes every time data changes. It also wastes a huge amount of disk space and memory.
5. **Optimal index:** We should create a composite index:
   ```sql
   CREATE INDEX idx_student_unread ON student_notifications (student_id, is_read, created_at DESC);
   ```

## Query: Placement notifications in the last 7 days

```sql
SELECT DISTINCT student_id 
FROM student_notifications sn
JOIN notifications n ON sn.notification_id = n.id
WHERE n.type = 'Placement' 
  AND n.created_at >= NOW() - INTERVAL '7 days';
```

---

# Stage 4

Fetching notifications on every page load for all students creates unnecessary database load. We can solve this with the following optimization strategies:

1. **In-Memory Caching (Redis)**
   * **Approach:** Cache the list or count of unread notifications for each student in Redis. When a page loads, the app reads from Redis instead of querying the SQL database.
   * **Trade-off:** High read performance and low database load. However, we must write cache-invalidation logic to clear the cache whenever a new notification is sent or marked as read.
2. **Push Architecture via WebSockets / SSE**
   * **Approach:** Establish a persistent connection. The server pushes new notifications to the client only when they are created, eliminating the need for the client to poll on every page load.
   * **Trade-off:** Minimal database queries. However, maintaining thousands of open TCP connections increases the memory footprint of the server.
3. **HTTP Browser Caching with ETags / Last-Modified**
   * **Approach:** Send an ETag representing the state of the student's inbox. On page load, the browser sends a lightweight validation request. If nothing has changed, the server returns a `304 Not Modified` without querying the full database details.
   * **Trade-off:** Saves bandwidth and processing time, but still requires a quick check to see if the state changed.

---

# Stage 5

## Pseudocode Shortcomings
1. **Synchronous Loop Blocking:** The code processes 50,000 students in a single synchronous loop. If one step (like sending an email) takes 500ms, processing all students sequentially will take over 6 hours.
2. **Single point of failure:** If the loop crashes midway (e.g., at student 20,000), there is no progress state tracking. We wouldn't easily know who received the notifications and who didn't.
3. **Tight Coupling:** Database writes and external network API calls are coupled. If the external Email API is slow or temporarily down, it blocks the database updates and push notifications.

## Redesign and Queue Architecture
To make the process fast and reliable, we should decouple the actions using a **Message Queue** (e.g., RabbitMQ, BullMQ, or Kafka).
1. When HR triggers "Notify All", the main thread inserts a single record in the database and pushes 50,000 jobs into the queue.
2. Multiple worker processes consume jobs concurrently from the queue.
3. If sending an email fails for a student, the worker retries that specific job with exponential backoff without affecting other students.

## Questions Response
1. **Logs indicate 200 failed emails midway. What now?**
   * Since we use a message queue, the 200 failed jobs are sent to a **Dead Letter Queue (DLQ)**. We can review the failure reasons (e.g. SMTP limits, invalid address) and safely trigger a retry on just those 200 failed jobs.
2. **Should saving to DB and sending email happen together?**
   * No, they should not happen in a single synchronous database transaction. Saving to the DB is a local, fast operation that should succeed immediately. Sending an email relies on external networks and SMTP servers, which are slow and prone to transient failures. Decoupling them ensures the user sees the notification instantly in-app, while the email is sent asynchronously.

## Revised Pseudocode

```javascript
// Publisher (Run on API endpoint)
async function notifyAll(studentIds, message) {
    const notificationId = await saveNotificationToDb(message);
    
    // Batch jobs to publish to the queue to avoid blocking
    const jobs = studentIds.map(studentId => ({
        studentId,
        notificationId,
        message
    }));
    
    await publishToQueue("notification_tasks", jobs);
}

// Worker (Runs asynchronously on background processes)
async function processNotificationJob(job) {
    try {
        // 1. Update student's feed in DB (fast local write)
        await saveStudentNotificationToDb(job.studentId, job.notificationId);
        
        // 2. Push real-time alert (non-blocking)
        await pushToApp(job.studentId, job.message);
        
        // 3. Send email asynchronously
        await sendEmail(job.studentId, job.message);
    } catch (error) {
        // Re-queue the email task specifically with backoff
        if (error.name === "EmailSendError") {
            await retryJob(job, 30); // retry in 30 seconds
        } else {
            throw error;
        }
    }
}
```

---

# Stage 6

To implement the **Priority Inbox**, we score and sort notifications based on weight and recency.

## Priority Logic Details
- **Weights:** Placement (3), Result (2), Event (1).
- **Recency:** Newer notifications are prioritized. We convert the timestamp into a numeric value (epoch seconds) and combine it with the type weight.
- **Scoring Function:**
  ```javascript
  score = (weight * 10000000000) + (timestamp_epoch_seconds)
  ```
  This creates a clear hierarchy: Placements always rank above Results, and Results above Events. Within the same type, notifications are sorted strictly by recency (newest first).
