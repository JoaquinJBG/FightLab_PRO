/**
 * Cabeceras para que Django (detrás de Render) distinga la IP real del
 * visitante en las rutas de auth, sin las cuales el throttle por IP del
 * backend comparte un único contador entre TODA la beta (todas las
 * peticiones le llegan desde las pocas IPs de salida de Vercel).
 *
 * Solo se añaden si BFF_SHARED_SECRET está configurado; si no, se omiten y
 * Django usa su throttle estándar (ver backend/users/throttling.py). El
 * secreto vive en una variable de entorno del lado del servidor (nunca
 * NEXT_PUBLIC_*): solo el BFF la conoce, así que Django solo se fía de la
 * cabecera X-Bff-Client-Ip cuando viene acompañada del secreto correcto.
 */
export function clientIpHeaders(req: Request): Record<string, string> {
  const secret = process.env.BFF_SHARED_SECRET;
  if (!secret) return {};
  const forwardedFor = req.headers.get("x-forwarded-for");
  const clientIp = forwardedFor ? forwardedFor.split(",")[0].trim() : req.headers.get("x-real-ip");
  if (!clientIp) return {};
  return { "X-Bff-Secret": secret, "X-Bff-Client-Ip": clientIp };
}
