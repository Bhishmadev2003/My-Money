import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

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

// Every signed-in user's data is stored in users/{uid}; users cannot access
// another user's document when the supplied Firestore rules are published.
export async function readUserData(uid) {
  const snapshot = await getDoc(doc(db, "users", uid));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function writeUserData(uid, data) {
  await setDoc(doc(db, "users", uid), {
    data,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// Shared category catalog: categories added by one signed-in user become
// available to all other signed-in users of the app. Financial records remain private.
const sharedCategoryDoc = doc(db, "sharedSettings", "categoryCatalog");
export async function readSharedCategories() {
  const snapshot = await getDoc(sharedCategoryDoc);
  const categories = snapshot.exists() ? snapshot.data().categories : [];
  return Array.isArray(categories) ? categories : [];
}
export async function mergeSharedCategories(categories) {
  const clean = [...new Set((Array.isArray(categories) ? categories : [])
    .map(value => String(value || "").trim()).filter(Boolean))];
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(sharedCategoryDoc);
    const existing = snapshot.exists() && Array.isArray(snapshot.data().categories)
      ? snapshot.data().categories : [];
    const merged = [...new Set([...existing, ...clean].map(value => String(value || "").trim()).filter(Boolean))];
    transaction.set(sharedCategoryDoc, { categories: merged, updatedAt: serverTimestamp() }, { merge: true });
  });
  return readSharedCategories();
}

const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(console.error);

const provider = new GoogleAuthProvider();

export const login = () => signInWithPopup(auth, provider);
export const logout = () => signOut(auth);
export const watchAuth = (callback) => onAuthStateChanged(auth, callback);
