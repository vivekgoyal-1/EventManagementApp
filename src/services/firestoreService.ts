import {
  collection,
  addDoc,
  query,
  orderBy,
  getDocs,
} from "firebase/firestore";
import { db } from "./firebase";

export async function addTask(title: string) {
  const col = collection(db, "tasks");
  const doc = await addDoc(col, { title, createdAt: new Date() });
  return doc.id;
}

export async function fetchTasks() {
  const q = query(collection(db, "tasks"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
