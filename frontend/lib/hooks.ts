"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  biometrics,
  me,
  profile,
  progressPhoto,
  type Biometrics,
  type Me,
  type Profile,
  type ProgressPhoto,
} from "./schemas";
import { resetActivityUid } from "./activities";

async function getJson(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function sendJson(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.detail === "string" ? data.detail : String(res.status));
  }
  return data;
}

export function useMe() {
  return useQuery<Me>({
    queryKey: ["me"],
    queryFn: async () => me.parse(await getJson("/api/proxy/me")),
  });
}

export function useProfile() {
  return useQuery<Profile>({
    queryKey: ["profile"],
    queryFn: async () => profile.parse(await getJson("/api/proxy/me/profile")),
  });
}

export function useBiometrics() {
  return useQuery<Biometrics[]>({
    queryKey: ["biometrics"],
    queryFn: async () => z.array(biometrics).parse(await getJson("/api/proxy/me/biometrics")),
  });
}

export function useCreateBiometrics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      sendJson("/api/proxy/me/biometrics", "POST", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["biometrics"] }),
  });
}

export function useDeleteBiometrics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/proxy/me/biometrics/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) throw new Error(String(res.status));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["biometrics"] }),
  });
}

export function usePhotos() {
  return useQuery<ProgressPhoto[]>({
    queryKey: ["photos"],
    queryFn: async () => z.array(progressPhoto).parse(await getJson("/api/proxy/me/photos")),
  });
}

// Margen por debajo del límite de ~4.5 MB que Vercel impone al cuerpo de las
// funciones del BFF. compressImage() ya deja los archivos muy por debajo de
// esto (<1.5 MB); este tope solo entra en juego en su fallback, cuando el
// navegador no puede comprimir (p. ej. HEIC fuera de Safari) y se sube el
// archivo original tal cual.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function useUploadPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(
          "La foto pesa demasiado para subirla sin comprimir. Prueba con otra foto o desde otro navegador.",
        );
      }
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/proxy/me/photos", {
        method: "POST",
        credentials: "include",
        body: form, // sin Content-Type manual: fetch pone el boundary
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.detail === "string" ? data.detail : String(res.status));
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photos"] }),
  });
}

export function useDeletePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/proxy/me/photos/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) throw new Error(String(res.status));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photos"] }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      sendJson("/api/proxy/me/profile", "PATCH", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson("/api/auth/logout", "POST"),
    onSuccess: () => {
      qc.clear();
      resetActivityUid(); // que nada se encole a nombre del usuario saliente
    },
  });
}
