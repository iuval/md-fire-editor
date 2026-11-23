// Replace with your Firebase project config
// Get this from Firebase Console → Project Settings → General → Your apps → SDK setup and configuration
// There is no Storage in this app (notes live in Firestore), so the bucket is
// deliberately absent: pointing `storageBucket` at the value Firebase Console
// suggests targets a bucket the project never created.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
}

export default firebaseConfig
