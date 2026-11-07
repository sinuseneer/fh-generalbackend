const mongoose = require('mongoose');


// const MONGO_URI = 'mongodb+srv://fhuser:fhpassword@cluster0.zxgpcla.mongodb.net/FHgeneralEquipments';



// console.log(MONGO_URI);
const db = mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  
})
.then(() => console.log('Connected to MongoDB'))
.catch(error => console.error('Error connecting to MongoDB:', error));


module.exports=db;
// import mongoose from "mongoose";

// const MONGO_URI = process.env.MONGO_URI;

// async function connectDB() {
//   try {
//     await mongoose.connect(MONGO_URI);
//     console.log("✅ MongoDB connected successfully");
//   } catch (error) {
//     console.error("❌ MongoDB connection error:", error);
//   }
// }

// export default connectDB;
