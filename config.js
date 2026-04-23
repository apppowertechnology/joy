// AUDACIOUS SIP - Global Configuration
const firebaseConfig = {
    databaseURL: "https://audacious-sip-default-rtdb.firebaseio.com/",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const CLOUDINARY_CLOUD_NAME = "dtgklvqgh";
const CLOUDINARY_UPLOAD_PRESET = "AUDACIOUS SIP";
const CLOUDINARY_API_KEY = "882182112947198";

// Paystack Live Keys
const PAYSTACK_PUBLIC_KEY = "pk_live_3a2d9b17bf073866779fb99b2a14ac5aeb5b8fb4";

// Backend API URL (Update this when deploying to production)
const API_URL = window.location.origin + "/api";