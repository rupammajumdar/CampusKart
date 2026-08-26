const app = require('../backend/server');
const { connectDB } = require('../backend/lib/db');

module.exports = async (req, res) => {
  try {
    await connectDB();
  } catch (err) {
    console.error('Serverless DB Connect Error:', err);
  }
  return app(req, res);
};
