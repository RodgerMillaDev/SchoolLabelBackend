const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const firestore = admin.firestore();
const firebaseAuth = admin.auth();
const serverTimestamp = admin.firestore.FieldValue.serverTimestamp;

module.exports = {
  admin,
  firestore,
  firebaseAuth,
  serverTimestamp,
};