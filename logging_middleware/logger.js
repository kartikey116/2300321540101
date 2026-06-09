import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function Log(stack, level, packageName, message) {
  const token = process.env.ACCESS_TOKEN;
  try {
    const response = await axios.post(
      "http://4.224.186.213/evaluation-service/logs",
      {
        stack,
        level,
        package: packageName,
        message
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error("Log API Error:", error.response?.data || error.message);
  }
}

export default Log; 

