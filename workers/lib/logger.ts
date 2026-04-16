type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
	const payload = {
		level,
		message,
		context,
		timestamp: new Date().toISOString(),
	};

	console[level === "info" ? "log" : level](JSON.stringify(payload));
}
