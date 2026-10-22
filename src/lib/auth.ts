import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  type User
} from "firebase/auth";
import { auth } from "./firebase";
import { createUserDoc, getUserDoc } from "./firestore";
import { unregisterPush } from "./push";

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
  // Antes de salir (después ya no hay permiso para escribir en users/{uid}).
  const uid = auth.currentUser?.uid;
  if (uid) await unregisterPush(uid);
  await fbSignOut(auth);
}
