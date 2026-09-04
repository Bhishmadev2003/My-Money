import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDVryJ1iSfrtpk7HXbDDaxWT7n2Om4hios",
  authDomain: "my-money-3d05e.firebaseapp.com",
  projectId: "my-money-3d05e",
  storageBucket: "my-money-3d05e.firebasestorage.app",
  messagingSenderId: "1048810218419",
  appId: "1:1048810218419:web:775fc52b287c67b1f021c6"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
const auth = getAuth(app);
// Keep the Google session when the browser is refreshed or reopened.
setPersistence(auth, browserLocalPersistence).catch(console.error);
const provider = new GoogleAuthProvider();

export const login = () => signInWithPopup(auth, provider);
export const logout = () => signOut(auth);
export const watchAuth = (callback) => onAuthStateChanged(auth, callback);
