const cors = require("cors");
const axios = require("axios");
const express = require("express");
require("dotenv").config();

const {
  admin,
  firestore,
  serverTimestamp,
  firebaseAuth,
} = require("./firebaseService");

const app = express();
app.use(express.json());
app.use(cors());

const port = process.env.PORT;

const adminUIDS = [process.env.adminOne];

adminUIDS.forEach((uid) => {
  admin
    .auth()
    .setCustomUserClaims(uid, { admin: true })
    .then(() => {
      console.log("Admin is set", uid);
    })
    .catch((err) => {
      console.error("Admin authentication failed", err);
    });
});


app.post("/Aloo", (req,res)=>{
    res.send("Yess i am away")
})

app.get("/", (req, res) => {
  res.send("Alloo we are live my bwoy. Driving App online")
})

app.listen(port, () => {
  console.log("Hello Ras, tuko on!")
})
