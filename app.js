const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");
const https = require("https")
const express = require("express");
require("dotenv").config();

const {
  admin,
  firestore,
  serverTimestamp,
  firebaseAuth,
} = require(process.env.FIREBASE_SERVICE_ACCOUNT);

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
    res.json("Yess i am awake")
})

app.get("/", (req, res) => {
  res.send("Alloo we are live my bwoy. Driving App online")
})

app.listen(port, () => {
  console.log("Hello Ras, tuko on!")
})


app.post('/payNow',(req,res)=>{
    const {uid,payEmail,name}=req.body
  

    const params = JSON.stringify({
      "email": payEmail,
      "amount": 1 * 100,
    "currency": "KES",
    "channels":["mobile_money"],
      "callback_url":`http://localhost:3000/confirmpayment`
    })
    
    const options = {
      hostname: 'api.paystack.co',

      port: 443,
      path: '/transaction/initialize',
      method: 'POST',
      headers: {
        // Authorization: `Bearer ${process.env.PP_LIVE_SECRETKEY}`,
        Authorization: `Bearer ${process.env.PP_TEST_SECRETKEY}`,
        'Content-Type': 'application/json'
      }
    }
    
    const payStackreq = https.request(options, payStackres => {
      let data = ''
    
      payStackres.on('data', (chunk) => {
        data += chunk
      });
    
      payStackres.on('end', () => {
        try {
            const paySatckrespData=JSON.parse(data)
            console.log(paySatckrespData)
            res.json(paySatckrespData)

        } catch (error) {
            console.log(error)
        }

      })

    }).on('error', error => {
      console.error(error)
      res.status(500).json({ error: 'Request failed' });

    })
    
    payStackreq.write(params)

    payStackreq.end()

})



app.post("/paystack-webhook", express.json({ type: "*/*" }), async (req, res) => {
  try {
    const secret = process.env.PP_TEST_SECRETKEY;

    const hash = crypto
      .createHmac("sha512", secret)
      .update(JSON.stringify(req.body))
      .digest("hex");

    // Verify Paystack signature
    if (hash !== req.headers["x-paystack-signature"]) {
      return res.status(401).send("Invalid signature");
    }

    const event = req.body;

    if (event.event === "charge.success") {
      const data = event.data;

      const reference = data.reference;
      const amount = data.amount / 100;
      const status = data.status;
      const email = data.customer.email;

      // Save to Firestore
      await firestore.collection("transactions").doc(reference).set({
        reference,
        email,
        amount,
        status,
        paidAt: serverTimestamp(),
      });

      console.log("Transaction saved:", reference);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }
});


app.post("/trxnStatus", async (req, res) => {
  const { refCode, userId } = req.body;

  const options = {
    hostname: "api.paystack.co",
    port: 443,
    path: `/transaction/verify/${refCode}`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.PP_TEST_SECRETKEY}`,
      "Content-Type": "application/json",
    },
  };

  const request = https.request(options, (paystackRes) => {
    let data = "";

    paystackRes.on("data", (chunk) => {
      data += chunk;
    });

    paystackRes.on("end", async () => {
      try {
        const paystackRespData = JSON.parse(data);

        const status = paystackRespData.data.status;
        const amount = paystackRespData.data.amount / 100;
        const email = paystackRespData.data.customer.email;

        if (status === "success") {
          await firestore.collection("transactions").doc(refCode).set({
            reference: refCode,
            email,
            amount,
            status,
            userId,
            verifiedAt: serverTimestamp(),
          });
        }

        res.json(paystackRespData);
      } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Verification failed" });
      }
    });
  });

  request.on("error", (error) => {
    console.error(error);
    res.status(500).json({ error: "Request failed" });
  });

  request.end();
});