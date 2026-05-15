import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  type User
} from "firebase/auth";
import { auth } from "./firebase";
import { createUserDoc, getUserDoc } from "./firestore";

export async function signIn(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signUp(email: string, password: string, name: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const existing = await getUserDoc(cred.user.uid);
  if (!existing) {
    await createUserDoc(cred.user.uid, email, name);
  }
  return cred.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}
