import express, { type Request, type Response } from "express";
import { z } from "zod";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Health check endpoint
app.get("/api/health", (req: Request, res: Response) => {
	res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Sample API endpoint
app.get("/api/hello", (req: Request, res: Response) => {
	res.json({ message: "Hello from backend!" });
});

// Example with Zod validation
const UserSchema = z.object({
	name: z.string(),
	email: z.string().email(),
});

app.post("/api/users", (req: Request, res: Response) => {
	try {
		const user = UserSchema.parse(req.body);
		res.json({ success: true, user });
	} catch (error) {
		res.status(400).json({ error: "Invalid user data" });
	}
});

app.listen(PORT, () => {
	console.log(`Backend server running on http://localhost:${PORT}`);
});
