const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");
const https = require("https");
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

const adminUIDS = [
  process.env.adminOne,
  process.env.adminTwo,
  process.env.adminThree
];

adminUIDS.forEach((uid) => {
  if (!uid) return;

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
  res.json("Yess i am awake");
});

app.get("/", (req, res) => {
  res.send("Alloo we are live my bwoy. Driving App online");
});

app.listen(port, () => {
  console.log("Hello Ras, tuko on!");
});


app.post("/paystack-webhook", express.json({ type: "*/*" }), async (req, res) => {
  try {
    const secret = process.env.PP_TEST_SECRETKEY;

    const hash = crypto
      .createHmac("sha512", secret)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.status(401).send("Invalid signature");
    }

    const event = req.body;

    if (event.event === "charge.success") {
      const data = event.data;

      const reference = data.reference;
      const amount = data.amount / 100;
      const status = data.status;
      const email = data.customer?.email || "";

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
    console.error("Webhook error:", error);
    res.sendStatus(500);
  }
});


app.post("/payNow", (req, res) => {
  const {
    uid,
    payEmail,
    name,
    grandTotal,
    delText
  } = req.body;

  if (!payEmail) {
    return res.status(400).json({
      status: false,
      message: "Email is required"
    });
  }

  if (!grandTotal || Number(grandTotal) <= 0) {
    return res.status(400).json({
      status: false,
      message: "Invalid payment amount"
    });
  }

  // const amount = Math.round(Number(grandTotal) * 100);
  const amount = 1 * 100;

  const params = JSON.stringify({
    email: payEmail,
    amount,
    currency: "KES",
    channels: ["mobile_money"],
    callback_url: "https://schoollabelskenya.com/confirmpayment",
    metadata: {
      userId: uid || "guest",
      customerName: name || "Guest User",
      customerEmail: payEmail,
      deliveryText: delText || "",
      customerType: uid && uid !== "guest"
        ? "authenticated"
        : "guest"
    }
  });

  const options = {
    hostname: "api.paystack.co",
    port: 443,
    path: "/transaction/initialize",
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PP_TEST_SECRETKEY}`,
      "Content-Type": "application/json"
    }
  };

  const payStackreq = https.request(options, (payStackres) => {
    let data = "";

    payStackres.on("data", (chunk) => {
      data += chunk;
    });

    payStackres.on("end", () => {
      try {
        const payStackrespData = JSON.parse(data);

        console.log("Paystack initialization:", payStackrespData);

        if (!payStackrespData.status) {
          return res.status(400).json(payStackrespData);
        }

        res.json(payStackrespData);
      } catch (error) {
        console.error("Paystack response error:", error);

        res.status(500).json({
          status: false,
          message: "Unable to process Paystack response"
        });
      }
    });
  });

  payStackreq.on("error", (error) => {
    console.error("Paystack request error:", error);

    res.status(500).json({
      status: false,
      error: "Request failed"
    });
  });

  payStackreq.write(params);
  payStackreq.end();
});


app.post("/trxnStatus", async (req, res) => {
  const {
    refCode,
    userId,
    destination,
    phone,
    name,
    date,
    delText,
    guestEmail,
    cartItems
  } = req.body;

  console.log("Stage 1: Request received");
  console.log("Reference:", refCode);
  console.log("User ID:", userId);
  console.log("Customer:", name);
  console.log("Customer type:", userId === "guest" ? "guest" : "authenticated");

  if (!refCode) {
    return res.status(400).json({
      status: false,
      message: "Transaction reference is required"
    });
  }

  const options = {
    hostname: "api.paystack.co",
    port: 443,
    path: `/transaction/verify/${refCode}`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.PP_TEST_SECRETKEY}`,
      "Content-Type": "application/json"
    }
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

        if (!paystackRespData.data) {
          return res.status(400).json({
            status: false,
            message: "Invalid Paystack response"
          });
        }

        const paymentData = paystackRespData.data;

        const status = paymentData.status;
        const amount = paymentData.amount / 100;

        const email =
          paymentData.customer?.email ||
          guestEmail ||
          "";

        if (status !== "success") {
          return res.json({
            status: false,
            message: "Payment not successful"
          });
        }

        const orderRef = firestore
          .collection("Orders")
          .doc(refCode);

        const orderSnap = await orderRef.get();

        if (orderSnap.exists) {
          console.log("Transaction already processed");

          return res.json({
            status: true,
            message: "already_processed",
            data: {
              amount
            }
          });
        }

        let finalName = name || "Guest User";
        let finalCartItems = Array.isArray(cartItems)
          ? cartItems
          : [];
        let finalUserId = userId || "guest";

        if (finalUserId !== "guest") {
          console.log("Processing authenticated customer");

          const userRef = firestore
            .collection("Users")
            .doc(finalUserId);

          const userSnap = await userRef.get();

          if (!userSnap.exists) {
            return res.status(404).json({
              status: false,
              message: "User not found"
            });
          }

          const userData = userSnap.data();

          finalName =
            userData.name ||
            name ||
            "Customer";

          finalCartItems =
            Array.isArray(userData.cartItems)
              ? userData.cartItems
              : [];

          await userRef.update({
            cartItems: []
          });

          console.log("Authenticated user's cart cleared");
        } else {
          console.log("Processing guest customer");

          finalName =
            name ||
            "Guest User";

          finalCartItems =
            Array.isArray(cartItems)
              ? cartItems
              : [];

          console.log(
            "Guest cart items:",
            finalCartItems.length
          );
        }

        await orderRef.set({
          transactionId: refCode,

          userId: finalUserId,

          customerType:
            finalUserId === "guest"
              ? "guest"
              : "authenticated",

          destination: destination || "",

          delText: delText || "",

          phone: phone || "",

          date:
            date ||
            new Date().toISOString(),

          userName: finalName,

          email,

          amount,

          cartItems: finalCartItems,

          status,

          createdAt: serverTimestamp()
        });

        try {
          await firestore
            .collection("Stats")
            .doc("earnings")
            .update({
              totalRevenue:
                admin.firestore.FieldValue.increment(amount)
            });
        } catch (statsError) {
          console.error(
            "Revenue stats update error:",
            statsError
          );
        }

        const now = new Date();

        const year =
          now.getFullYear().toString();

        const months = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec"
        ];

        const month =
          months[now.getMonth()];

        try {
          await firestore
            .collection("Stats")
            .doc("Sales")
            .collection("years")
            .doc(year)
            .set(
              {
                [month]:
                  admin.firestore.FieldValue.increment(
                    amount
                  )
              },
              {
                merge: true
              }
            );
        } catch (salesError) {
          console.error(
            "Sales stats update error:",
            salesError
          );
        }

        console.log(
          "Stage 3: Order saved successfully"
        );

        return res.json({
          status: true,
          message: "Verification successful",
          data: {
            amount
          }
        });

      } catch (error) {
        console.error(
          "Verification error:",
          error
        );

        return res.status(500).json({
          status: false,
          message: "Verification failed"
        });
      }
    });
  });

  request.on("error", (error) => {
    console.error(
      "Paystack verification request error:",
      error
    );

    res.status(500).json({
      status: false,
      message: "Request failed"
    });
  });

  request.end();
});


app.post("/sendSMStoAdmin", async (req, res) => {
  const {
    CustomerName
  } = req.body;

  try {
    const message = `
Hi Ken,

A new order has been placed by ${CustomerName || "a customer"}. Check the dashboard to process it.
`;

    const url =
      "https://sms.textsms.co.ke/api/services/sendsms";

    const response = await fetch(url, {
      method: "POST",

      headers: {
        "Content-type": "application/json"
      },

      body: JSON.stringify({
        apikey: process.env.SMS_APIKEY,
        partnerID: process.env.SMS_PARTNERID,
        message,
        shortcode: process.env.SMS_SHORTCODE,
        mobile: process.env.SMS_ADMINFON
      })
    });

    const result =
      await response.json();

    console.log(result);

    res.send(result);

  } catch (error) {
    console.error(
      "Admin SMS error:",
      error
    );

    res.status(500).json({
      status: false,
      message: "Failed to send admin SMS"
    });
  }
});


function toKenyanFormat(fon) {
  if (!fon) {
    throw new Error(
      "Phone number is required"
    );
  }

  if (
    fon.length === 10 &&
    fon.startsWith("0")
  ) {
    return "254" + fon.slice(1);
  }

  if (
    fon.length === 12 &&
    fon.startsWith("254")
  ) {
    return fon;
  }

  throw new Error(
    "Invalid phone number"
  );
}


app.post("/sendSMStoClient", async (req, res) => {
  const {
    fon,
    name
  } = req.body;

  try {
    const message = `
Hello ${name || "Customer"},

Your purchase from School Labels Kenya was successful. We have received your order and will start processing it shortly. Deliveries are dispatched every Tuesday and Friday.`;

    const url =
      "https://sms.textsms.co.ke/api/services/sendsms";

    const response = await fetch(url, {
      method: "POST",

      headers: {
        "Content-type": "application/json"
      },

      body: JSON.stringify({
        apikey: process.env.SMS_APIKEY,
        partnerID: process.env.SMS_PARTNERID,
        message,
        shortcode: process.env.SMS_SHORTCODE,
        mobile: toKenyanFormat(fon)
      })
    });

    const result =
      await response.json();

    console.log(result);

    res.send(result);

  } catch (error) {
    console.error(
      "Client SMS error:",
      error
    );

    res.status(500).json({
      status: false,
      message: "Failed to send client SMS"
    });
  }
});


app.post("/smsBalance", async (req, res) => {
  try {
    const url =
      "https://sms.textsms.co.ke/api/services/getbalance";

    const response = await fetch(url, {
      method: "POST",

      headers: {
        "Content-type": "application/json"
      },

      body: JSON.stringify({
        apikey: process.env.SMS_APIKEY,
        partnerID: process.env.SMS_PARTNERID
      })
    });

    const result =
      await response.json();

    console.log(result);

    res.send(result);

  } catch (error) {
    console.error(
      "SMS balance error:",
      error
    );

    res.status(500).json({
      status: false,
      message: "Failed to get SMS balance"
    });
  }
});