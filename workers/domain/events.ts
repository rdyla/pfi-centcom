import { z } from "zod";

export const providerSlugSchema = z.enum(["zoom", "ringcentral"]);

export const webhookEnvelopeSchema = z.object({
	tenantId: z.string().min(1),
	resourceType: z.string().min(1),
	eventType: z.string().min(1),
	providerEventId: z.string().min(1).optional(),
	deliveryId: z.string().min(1).optional(),
	occurredAt: z.string().datetime().optional(),
	payload: z.record(z.string(), z.unknown()),
});

export type ProviderSlug = z.infer<typeof providerSlugSchema>;
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

export interface PlatformOverview {
	title: string;
	description: string;
	providers: Array<{
		name: string;
		status: "planned" | "ready" | "attention";
		details: string;
	}>;
	processingStages: string[];
}

export const platformOverview: PlatformOverview = {
	title: "PFI CentCom",
	description:
		"Central monitoring and alerting for Zoom, RingCentral, and Dynamics CE case orchestration.",
	providers: [
		{
			name: "Zoom",
			status: "ready",
			details: "Webhook endpoint scaffolded and ready for signature verification.",
		},
		{
			name: "RingCentral",
			status: "ready",
			details: "Webhook endpoint scaffolded and ready for tenant-specific connection settings.",
		},
		{
			name: "Dynamics 365 CE",
			status: "planned",
			details: "Async case create/update adapter will attach after alert lifecycle is in place.",
		},
	],
	processingStages: [
		"Ingest provider webhook",
		"Validate tenant and normalize payload",
		"Queue durable background processing",
		"Evaluate alerts and case sync actions",
	],
};
