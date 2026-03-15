import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth"

import { auth, googleProvider } from "./firebase"

export async function signInWithGoogle() {
  try {
    return await signInWithPopup(auth, googleProvider)
  } catch (error) {
    console.error("Google sign in failed:", error)
    throw error
  }
}

export function signInWithEmailPassword(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password)
}

export function registerWithEmailPassword(email: string, password: string) {
  return createUserWithEmailAndPassword(auth, email, password)
}

export async function signOutUser() {
  try {
    await signOut(auth)
  } catch (error) {
    console.error("Sign out failed:", error)
    throw error
  }
}