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
} = require("./firebaseService");
const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

const port = process.env.PORT;
const adminUIDS = [process.env.adminOne,process.env.adminTwo,process.env.adminThree];
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

app.post("/Aloo", (req, res) => {
  res.json("Yess i am awake")
})

app.get("/", (req, res) => {
  res.send("Alloo we are live my bwoy. Driving App online")
})

app.listen(port, () => {
  console.log("Hello Ras, tuko on!")
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
app.post('/payNow', (req, res) => {
  const { uid, payEmail, name,grandTotal,delText } = req.body


  const params = JSON.stringify({
    "email": payEmail,
    // "amount": parseInt(grandTotal) * 100,
    "amount": 1 * 100,
    "currency": "KES",
    "channels": ["mobile_money"],
    "callback_url": `https://schoollabelskenya.com/confirmpayment`
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
        const paySatckrespData = JSON.parse(data)
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

app.post("/trxnStatus", async (req, res) => {
  const { refCode, userId, destination, phone, name, date, delText } = req.body;

  console.log("Stage 1: Request received");

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
        console.log("Stage 2: Paystack response received");

        const paystackRespData = JSON.parse(data);

        const status = paystackRespData.data.status;
        const amount = paystackRespData.data.amount / 100;
        const email = paystackRespData.data.customer.email;

        if (status !== "success") {
          return res.json({
            status: false,
            message: "Payment not successful",
          });
        }

        // 🔴 Check if transaction already processed
        const orderRef = firestore.collection("Orders").doc(refCode);
        const orderSnap = await orderRef.get();

        if (orderSnap.exists) {
          console.log("Transaction already processed");

          return res.json({
            status: true,
            message: "already_processed",
            data: {
              amount,
            },
          });
        }

        // 1️⃣ Get user document
        const userRef = firestore.collection("Users").doc(userId);
        const userSnap = await userRef.get();

        if (!userSnap.exists) {
          return res.status(404).json({ error: "User not found" });
        }

        const userData = userSnap.data();
        const cartItems = userData.cartItems || [];
        const userName = userData.name;

        // 2️⃣ Save order
        await orderRef.set({
          transactionId: refCode,
          userId,
          destination,
          delText,
          phone,
          date,
          userName,
          email,
          amount,
          cartItems,
          status,
          createdAt: serverTimestamp(),
        });

        // 3️⃣ Update total revenue
        await firestore.collection("Stats").doc("earnings").update({
          totalRevenue: admin.firestore.FieldValue.increment(amount),
        });

        // 4️⃣ Update monthly sales stats
        const now = new Date();
        const year = now.getFullYear().toString();

        const months = [
          "Jan","Feb","Mar","Apr","May","Jun",
          "Jul","Aug","Sep","Oct","Nov","Dec"
        ];

        const month = months[now.getMonth()];

        await firestore
          .collection("Stats")
          .doc("Sales")
          .collection("years")
          .doc(year)
          .set(
            {
              [month]: admin.firestore.FieldValue.increment(amount),
            },
            { merge: true }
          );

        // 5️⃣ Clear user's cart
        await userRef.update({
          cartItems: [],
        });

        console.log("Stage 3: Order saved successfully");

        return res.json({
          status: true,
          message: "Verification successful",
          data: {
            amount,
          },
        });

      } catch (error) {
        console.log("Verification error:", error);

        return res.status(500).json({
          status: false,
          message: "Verification failed",
        });
      }
    });
  });

  request.on("error", (error) => {
    console.error("Request error:", error);

    res.status(500).json({
      status: false,
      message: "Request failed",
    });
  });

  request.end();
});

app.post("/sendSMStoAdmin",async (req,res)=>{
  const {fon,CustomerName}=req.body
  try {
    const message=
`
Hi Ken,

A new order has been placed by ${CustomerName}. Check the dashboard to process it.
`

    const url = "https://sms.textsms.co.ke/api/services/sendsms"
    const response = await fetch(url,{
      method:"POST",
      headers:{
        'Content-type':'application/json'
      },
      body:JSON.stringify({
        "apikey":process.env.SMS_APIKEY,
        "partnerID":process.env.SMS_PARTNERID,
        "message":message,
        "shortcode":process.env.SMS_SHORTCODE,
        "mobile":process.env.SMS_ADMINFON
      })
    })
    const result =await response.json()
    console.log(result)
    res.send(result)
  } catch (error) {
    console.log(error)
  }
})
function toKenyanFormat(fon) {
  if (fon.length === 10 && fon.startsWith("0")) {
    return "254" + fon.slice(1);
  }
  throw new Error("Invalid phone number");
}


app.post("/sendSMStoClient",async (req,res)=>{
  const {fon,name}=req.body
  try {
    const message=
`
Hello ${name},

Your purchase from School Labels Kenya was successful. We have received your order and will start processing it shortly. Deliveries are dispatched every Tuesday and Friday.`

    const url = "https://sms.textsms.co.ke/api/services/sendsms"
    const response = await fetch(url,{
      method:"POST",
      headers:{
        'Content-type':'application/json'
      },
      body:JSON.stringify({
        "apikey":process.env.SMS_APIKEY,
        "partnerID":process.env.SMS_PARTNERID,
        "message":message,
        "shortcode":process.env.SMS_SHORTCODE,
        "mobile":toKenyanFormat(fon)
      })
    })
    const result =await response.json()
    console.log(result)
    res.send(result)
  } catch (error) {
    console.log(error)
  }
  
})

app.post("/smsBalance", async (req,res)=>{
  try {
    const url="https://sms.textsms.co.ke/api/services/getbalance";
    const response= await fetch(url,{
      method:"POST",
      headers:{
        'Content-type':'application/json'
      },
      body:JSON.stringify({
        "apikey":process.env.SMS_APIKEY,
        "partnerID":process.env.SMS_PARTNERID,
      })
    })
    const result=await response.json()
    res.send(result)
    console.log(result)
  } catch (error) {
    console.log(error)
  }
})
 