const mongoose = require('mongoose');
const env = require('./env');

async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGO_URI, { dbName: 'appdb' });
  console.log('[db] connected to MongoDB');
}

module.exports = { connectDB };
