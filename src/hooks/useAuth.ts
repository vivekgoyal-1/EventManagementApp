import { useEffect, useState } from "react"
import { doc, onSnapshot } from "firebase/firestore"

import { auth, db } from "../services/firebase"
import type { UserProfile } from "../types"

export function useAuth() {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let firestoreUnsub: (() => void) | undefined

    const authUnsub = auth.onAuthStateChanged((firebaseUser) => {

      // Clean previous Firestore listener
      firestoreUnsub?.()

      if (!firebaseUser) {
        setUser(null)
        setLoading(false)
        return
      }

      setLoading(true)

      const userRef = doc(db, "users", firebaseUser.uid)

      firestoreUnsub = onSnapshot(
        userRef,
        (snapshot) => {

          if (!snapshot.exists()) return

          const data = snapshot.data()

          const role = (data.role as UserProfile["role"]) ?? "attendee"

          setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email ?? "",
            displayName: firebaseUser.displayName ?? "",
            photoURL: firebaseUser.photoURL ?? "",
            role,
          })

          setLoading(false)
        },
        (error) => {
          console.error("Failed to load user profile", error)

          setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email ?? "",
            displayName: firebaseUser.displayName ?? "",
            photoURL: firebaseUser.photoURL ?? "",
            role: "attendee",
          })

          setLoading(false)
        }
      )
    })

    return () => {
      authUnsub()
      firestoreUnsub?.()
    }

  }, [])

  return { user, loading }
}