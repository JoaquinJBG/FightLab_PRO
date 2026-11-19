"use client";

// Fotos de tickets de la compra (fase 12, `/coach/tickets`). Se guardan en Cloudflare R2 a través
// del backend: el bucket es privado y cada foto se ve con una URL firmada que caduca, pedida por su
// dueño. El móvil comprime la foto (unos 300 KB) antes de subirla. Sin R2 configurado en el
// servidor, `enabled` es falso y la app lo explica.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { compressImage } from "./compress-image";
import { MenuError } from "./menu";

export const ticket = z.object({
  id: z.number(),
  taken_on: z.string(),
  plan_id: z.number().nullable(),
  size: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  note: z.string(),
  created_at: z.string(),
});
export type Ticket = z.infer<typeof ticket>;

export const ticketList = z.object({ enabled: z.boolean(), max_upload_mb: z.number(), tickets: z.array(ticket) });
export type TicketList = z.infer<typeof ticketList>;

// Lo que el móvil apunta (el servidor rechaza más de 2 MB y lo vuelve a codificar).
export const TICKET_MAX_SIDE = 1600;
export const TICKET_TARGET_BYTES = 300 * 1024;

const BASE = "/api/proxy/coach/tickets";

async function fail(res: Response): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new MenuError(typeof data?.code === "string" ? data.code : String(res.status), typeof data?.detail === "string" ? data.detail : "", data);
}

export function useTickets(planId: number | null) {
  return useQuery<TicketList>({
    queryKey: ["tickets", planId],
    queryFn: async () => {
      const res = await fetch(`${BASE}${planId ? `?plan=${planId}` : ""}`, { credentials: "include" });
      if (!res.ok) await fail(res);
      return ticketList.parse(await res.json());
    },
  });
}

export function useUploadTicket(planId: number | null) {
  const qc = useQueryClient();
  return useMutation<Ticket, MenuError, { file: File; takenOn?: string; note?: string }>({
    mutationFn: async ({ file, takenOn, note }) => {
      const small = await compressImage(file, { maxSide: TICKET_MAX_SIDE, maxBytes: TICKET_TARGET_BYTES });
      const form = new FormData();
      form.append("image", small, small.name);
      if (takenOn) form.append("taken_on", takenOn);
      if (planId) form.append("plan", String(planId));
      if (note) form.append("note", note);
      const res = await fetch(BASE, { method: "POST", credentials: "include", body: form });
      if (!res.ok) await fail(res);
      return ticket.parse(await res.json());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

/** Pide una URL firmada (caduca a los pocos minutos: se pide cada vez que se abre la foto). */
export async function ticketUrl(id: number): Promise<string> {
  const res = await fetch(`${BASE}/${id}/url`, { credentials: "include", cache: "no-store" });
  if (!res.ok) await fail(res);
  return z.object({ url: z.string(), expires_in: z.number() }).parse(await res.json()).url;
}

export function useDeleteTicket() {
  const qc = useQueryClient();
  return useMutation<unknown, MenuError, number>({
    mutationFn: async (id) => {
      const res = await fetch(`${BASE}/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) await fail(res);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}
