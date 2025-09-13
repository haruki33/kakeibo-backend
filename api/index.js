import express from "express";
import pkg from "pg";
import cors from "cors";
import dotenv from "dotenv";
import dotenvFlow from "dotenv-flow";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
dotenvFlow.config();

function renameKeys(objs) {
  return objs.map(({ category_id, ...rest }) => ({
    ...rest,
    categoryId: category_id,
  }));
}

function changeDateFormat(objs) {
  return objs.map(({ date, ...rest }) => ({
    ...rest,
    date: [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-"),
  }));
}

const dayStr = dotenv.config();
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const app = express();
app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

/// login
app.post("/signin", async (req, res) => {
  const { email, password } = req.body;

  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (rows.length === 0) {
      return res
        .status(401)
        .json({ error: "Invalid email or password (no user found)" });
    }
    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const accessToken = jwt.sign(
      { userId: user.id },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "30s" }
    );
    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: "30d" }
    );

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" ? true : false,
      sameSite: "strict",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res
      .status(200)
      .json({ token: accessToken, name: user.name, email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *",
      [name, email, hashedPassword]
    );
    const user = rows[0];
    res.status(201).json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/refresh_access_token", (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ error: "認証が必要です" });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);

    if (typeof decoded === "object" && decoded.userId) {
      const accessToken = jwt.sign(
        { userId: decoded.userId },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "30s" }
      );
      return res.status(200).json({ accessToken });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/// check token middleware
app.use((req, res, next) => {
  const bearer = req.headers.authorization;
  if (!bearer) {
    return res.status(401).json({ error: "認証が必要です" });
  }

  const [, token] = bearer.split(" ");
  if (!token) {
    return res.status(401).json({ error: "トークンが無効です" });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    if (typeof decoded === "object" && decoded.userId) {
      req.userId = decoded.userId;
      next();
    } else {
      return res.status(401).json({ error: "トークンが無効です" });
    }
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/// categories
app.get("/categories", async (req, res) => {
  try {
    const userId = req.userId;

    const { rows } = await pool.query(
      "SELECT * FROM categories WHERE user_id = $1 ORDER BY CASE WHEN type = 'income' THEN 1 WHEN type = 'expense' THEN 2 ELSE 3 END, name",
      [userId]
    );
    return res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/categories", async (req, res) => {
  const { name, type, description } = req.body;

  try {
    const userId = req.userId;

    const { rows } = await pool.query(
      "INSERT INTO categories (name, type, description, user_id) VALUES ($1, $2, $3, $4) RETURNING *",
      [name, type, description, userId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/categories/:id", async (req, res) => {
  const { id } = req.params;
  const { name, type, description } = req.body;

  try {
    const userId = req.userId;

    const { rows } = await pool.query(
      "UPDATE categories SET name = $1, type = $2, description = $3 WHERE id = $4 AND (user_id = $5 OR user_id IS NULL) RETURNING *",
      [name, type, description, id, userId]
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ error: "カテゴリーが見つからないか、編集権限がありません" });
    }

    res.status(200).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/categories/:id/delete", async (req, res) => {
  const { id } = req.params;

  try {
    const userId = req.userId;

    const { rows } = await pool.query(
      "UPDATE categories SET is_deleted = true WHERE id = $1 AND user_id = $2 RETURNING *",
      [id, userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.status(200).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/categories/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const userId = req.userId;
    const { rows } = await pool.query(
      "DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING *",
      [id, userId]
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
    const userId = req.userId;
    const { rows } = await pool.query(
      "SELECT * FROM transactions WHERE date >= to_date($1, 'YYYY-MM') AND date < to_date($1, 'YYYY-MM') + interval '1 month' AND user_id = $2 ORDER BY date",
      [month, userId]
    );

    const renamedRows = renameKeys(rows);
    const formattedRows = changeDateFormat(renamedRows);
    res.status(200).json(formattedRows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/transactions", async (req, res) => {
  const { date, amount, type, categoryId, memo } = req.body;

  try {
    const userId = req.userId;
    const { rows } = await pool.query(
      "INSERT INTO transactions (date, amount, type, category_id, memo, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [date, amount, type, categoryId, memo, userId]
    );
    const renamedRows = renameKeys(rows);
    const formattedRows = changeDateFormat(renamedRows);
    res.status(200).json(formattedRows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/transactions/:id", async (req, res) => {
  const { id } = req.params;
  const { date, amount, type, categoryId, memo } = req.body;

  try {
    const userId = req.userId;
    const { rows } = await pool.query(
      "UPDATE transactions SET date = $1, amount = $2, type = $3, category_id = $4, memo = $5 WHERE id = $6 AND user_id = $7 RETURNING *",
      [date, amount, type, categoryId, memo, id, userId]
    );
    const renamedRows = renameKeys(rows);
    const formattedRows = changeDateFormat(renamedRows);
    res.status(200).json(formattedRows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/transactions/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const userId = req.userId;
    const { rows } = await pool.query(
      "DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING *",
      [id, userId]
    );
    const renamedRows = renameKeys(rows);
    const formattedRows = changeDateFormat(renamedRows);
    res.status(200).json(formattedRows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/transactions/summary", async (req, res) => {
  const year = req.query.year;

  try {
    const userId = req.userId;
    const { rows } = await pool.query(
      "SELECT EXTRACT(MONTH FROM date) as month, category_id, SUM(amount) as total_amount FROM transactions WHERE date >= to_date($1, 'YYYY') AND date < to_date($1, 'YYYY') + interval '1 year' AND user_id = $2 GROUP BY month, category_id",
      [year, userId]
    );

    const renamedRows = renameKeys(rows);
    res.status(200).json(renamedRows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/transactions/:id/:month", async (req, res) => {
  const { id, month } = req.params;

  try {
    const userId = req.userId;
    const { rows } = await pool.query(
      "SELECT * FROM transactions WHERE category_id = $1 AND EXTRACT(MONTH FROM date) = $2 AND user_id = $3",
      [id, month, userId]
    );

    const renamedRows = renameKeys(rows);
    res.status(200).json(renamedRows);
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
