import express from "express";
import pkg from "pg";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

/// categories
app.get("/categories", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM categories ORDER BY name");
    res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/categories", async (req, res) => {
  const { name, color, type } = req.body;

  try {
    const { rows } = await pool.query(
      "INSERT INTO categories (name, color, type) VALUES ($1, $2, $3) RETURNING *",
      [name, color, type]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/categories/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      "DELETE FROM categories WHERE id = $1 RETURNING *",
      [id]
    );
    res.status(200).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/// transactions
app.get("/transactions", async (req, res) => {
  const month = req.query.month;

  try {
    const { rows } = await pool.query(
      "SELECT * FROM transactions WHERE date >= to_date($1, 'YYYY-MM') AND date < to_date($1, 'YYYY-MM') + interval '1 month' ORDER BY date",
      [month]
    );
    res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/transactions", async (req, res) => {
  const { date, amount, type, categoryId, memo } = req.body;

  try {
    const { rows } = await pool.query(
      "INSERT INTO transactions (date, amount, type, category_id, memo) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [date, amount, type, categoryId, memo]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/transactions/:id", async (req, res) => {
  const { id } = req.params;
  const { date, amount, type, categoryId, memo } = req.body;

  try {
    const { rows } = await pool.query(
      "UPDATE transactions SET date = $1, amount = $2, type = $3, category_id = $4, memo = $5 WHERE id = $6 RETURNING *",
      [date, amount, type, categoryId, memo, id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/transactions/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      "DELETE FROM transactions WHERE id = $1 RETURNING *",
      [id]
    );
    res.status(200).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/transactions/summary", async (req, res) => {
  const year = req.query.year;

  try {
    const { rows } = await pool.query(
      "SELECT EXTRACT(MONTH FROM date) as month, category_id, SUM(amount) as total_amount FROM transactions WHERE date >= to_date($1, 'YYYY') AND date < to_date($1, 'YYYY') + interval '1 year' GROUP BY month, category_id",
      [year]
    );
    res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
  });
}

export default app;
