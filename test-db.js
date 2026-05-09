require("dotenv").config();

const mysql = require("mysql2/promise");

async function testConnection() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT,
    });

    console.log("Koneksi ke database Laragon berhasil.");

    const [rows] = await connection.execute("SELECT DATABASE() AS database_name");
    console.log("Database aktif:", rows[0].database_name);

    await connection.end();
  } catch (error) {
    console.error("Koneksi ke database gagal.");
    console.error(error.message);
  }
}

testConnection();