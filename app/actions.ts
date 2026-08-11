"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";

// No l/I/0/O so codes stay readable when typed by hand.
const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

function newListId(): string {
  return Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

function refresh(listId: string) {
  revalidatePath(`/l/${listId}`);
}

export async function createList(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim() || "Shopping list";
  const id = newListId();
  await query("insert into lists (id, name) values ($1, $2)", [id, name.slice(0, 80)]);
  redirect(`/l/${id}`);
}

export async function addItem(formData: FormData) {
  const listId = String(formData.get("listId"));
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return;
  await query("insert into items (list_id, text) values ($1, $2)", [
    listId,
    text.slice(0, 200),
  ]);
  refresh(listId);
}

export async function toggleItem(formData: FormData) {
  const listId = String(formData.get("listId"));
  const id = String(formData.get("id"));
  await query("update items set done = not done where id = $1 and list_id = $2", [
    id,
    listId,
  ]);
  refresh(listId);
}

export async function deleteItem(formData: FormData) {
  const listId = String(formData.get("listId"));
  const id = String(formData.get("id"));
  await query("delete from items where id = $1 and list_id = $2", [id, listId]);
  refresh(listId);
}

export async function clearDone(formData: FormData) {
  const listId = String(formData.get("listId"));
  await query("delete from items where list_id = $1 and done", [listId]);
  refresh(listId);
}
