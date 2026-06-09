const WEIGHTS = {
  "Placement": 3,
  "Result": 2,
  "Event": 1
};

export function getPriorityNotifications(notifications, limit = 10) {
  const list = [...notifications];
  
  list.sort((a, b) => {
    const weightA = WEIGHTS[a.Type] || 0;
    const weightB = WEIGHTS[b.Type] || 0;
    
    if (weightA !== weightB) {
      return weightB - weightA;
    }
    
    const timeA = new Date(a.Timestamp.replace(' ', 'T')).getTime();
    const timeB = new Date(b.Timestamp.replace(' ', 'T')).getTime();
    
    return timeB - timeA;
  });
  
  return list.slice(0, limit);
}
