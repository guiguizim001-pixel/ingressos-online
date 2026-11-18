import { z } from "zod";
export const uuid = z.string().uuid();
export const short = z.string().trim().min(1).max(160);
export const email = z.string().trim().toLowerCase().email().max(254);
export const password = z
  .string()
  .min(12, "Use pelo menos 12 caracteres.")
  .max(128);
const instant = z.string().datetime({ offset: true });
export const orderSchema = z
  .object({
    expected_total_cents: z.number().int().positive().optional(),
    items: z
      .array(
        z
          .object({
            lot_id: uuid,
            quantity: z.number().int().min(1).max(20),
            attendees: z.array(short).min(1).max(20),
          })
          .refine(
            (i) => i.attendees.length === i.quantity,
            "Informe o nome de cada participante.",
          ),
      )
      .min(1)
      .max(20),
    contact: z.object({
      name: short,
      phone: z.string().regex(/^\d{10,13}$/, "Informe telefone com DDD."),
    }),
  })
  .refine(
    (b) => b.items.reduce((s, i) => s + i.quantity, 0) <= 20,
    "Limite de 20 ingressos por pedido.",
  );
export const eventSchema = z
  .object({
    name: short,
    description: z.string().max(8000).default(""),
    category_id: uuid.nullable(),
    active: z.boolean(),
    demo: z.boolean(),
    starts_at: instant,
    ends_at: instant,
    checkin_opens_at: instant,
    venue: short,
    city: short,
    address: short,
    organizer: short,
    rules: z.string().max(12000),
    capacity: z.number().int().min(1).max(1000000),
    status: z.enum(["draft", "published", "cancelled"]),
  })
  .superRefine((e, c) => {
    if (new Date(e.starts_at) >= new Date(e.ends_at))
      c.addIssue({
        code: "custom",
        message: "O término deve ser posterior ao início.",
      });
    if (new Date(e.checkin_opens_at) > new Date(e.starts_at))
      c.addIssue({
        code: "custom",
        message: "A entrada deve abrir antes ou no início do evento.",
      });
  });
export const lotSchema = z
  .object({
    sku: short,
    lot_name: z.string().trim().min(1).max(80),
    ticket_type: z.string().trim().min(1).max(80),
    price_cents: z.number().int().min(1).max(10000000),
    active: z.boolean(),
    sales_start: instant,
    sales_end: instant,
    max_per_order: z.number().int().min(1).max(20),
  })
  .refine(
    (l) => new Date(l.sales_start) < new Date(l.sales_end),
    "Fim das vendas deve ser posterior ao início.",
  );
const imageUrl = z
  .string()
  .max(1000)
  .refine(
    (v) =>
      v === "" || /^\/uploads\/[\w-]+\.webp$/.test(v) || /^https:\/\//.test(v),
    "Use URL HTTPS ou imagem enviada.",
  );
export const settingsSchema = z.object({
  name: short,
  tagline: z.string().max(160),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logo_url: imageUrl,
  contact: z.string().max(300),
  policies: z.string().max(20000),
  discount_percent: z.number().int().min(0).max(50),
});
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const need = (condition, status, message) => {
  if (!condition) throw new HttpError(status, message);
};
