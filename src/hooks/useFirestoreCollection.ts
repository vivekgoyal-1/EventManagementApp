import { useEffect, useState } from "react"
import { collection, onSnapshot } from "firebase/firestore"

import { db } from "../services/firebase"
import type { FirestoreDoc } from "../types"

export function useFirestoreCollection(collectionPath: string) {
  const [data, setData] = useState<FirestoreDoc[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const collRef = collection(db, collectionPath)

    const unsubscribe = onSnapshot(
      collRef,
      (snapshot) => {
        const docs: FirestoreDoc[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        } as FirestoreDoc))

        setData(docs)
        setLoading(false)
      },
      (error) => {
        console.error("Firestore collection error:", error)
        setLoading(false)
      }
    )

    return () => unsubscribe()
  }, [collectionPath])

  return { data, loading }
}