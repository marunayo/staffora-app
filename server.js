require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");
const mysql = require("mysql2/promise");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const app = express();

const PORT = process.env.PORT || 3000;

// ===============================
// Database Connection
// ===============================
// Credential database diambil dari file .env,
// bukan ditulis langsung di dalam source code.
async function getDbConnection() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT),
  });
}

// ===============================
// Amazon S3 Client
// ===============================
// Credential AWS diambil dari file .env,
// bukan ditulis langsung di dalam source code.
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// ===============================
// Upload Configuration
// ===============================
// File disimpan sementara di memory, bukan di folder lokal.
// Setelah itu file langsung dikirim ke Amazon S3.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // maksimal 5 MB
  },
});

// ===============================
// Static Folder
// ===============================
app.use(express.static("public"));

// ===============================
// Home Route
// ===============================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===============================
// Helper: Upload File to S3
// ===============================
async function uploadFileToS3(file) {
  const safeFileName = file.originalname.replace(/\s+/g, "-").toLowerCase();

  const fileKey = `uploads/${Date.now()}-${safeFileName}`;

  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET,
    Key: fileKey,
    Body: file.buffer,
    ContentType: file.mimetype,
  });

  await s3Client.send(command);

  const publicUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;

  return publicUrl;
}

// ===============================
// Submit Application Route
// ===============================
app.post("/submit", upload.single("file"), async (req, res) => {
  let connection;

  try {
    const { nama, email } = req.body;
    const file = req.file;

    // Validasi sederhana
    if (!nama || !email || !file) {
      return res.status(400).send("Nama, email, dan dokumen wajib diisi.");
    }

    // 1. Upload file ke Amazon S3
    const documentUrl = await uploadFileToS3(file);

    // 2. Simpan data teks + URL S3 ke database
    connection = await getDbConnection();

    await connection.execute(
      "INSERT INTO applicants (full_name, email, document_url) VALUES (?, ?, ?)",
      [nama, email, documentUrl]
    );

    console.log("Data berhasil disimpan ke database:");
    console.log("Nama:", nama);
    console.log("Email:", email);
    console.log("File:", file.originalname);
    console.log("URL S3:", documentUrl);

    // 3. Response sukses ke browser
    res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8" />
        <title>Staffora - Success</title>

        <style>
          * {
            box-sizing: border-box;
            font-family: Arial, sans-serif;
          }

          body {
            margin: 0;
            min-height: 100vh;
            background: linear-gradient(135deg, #ecfdf5, #f8fafc);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px;
          }

          .container {
            width: 100%;
            max-width: 620px;
            background: #ffffff;
            border-radius: 18px;
            padding: 32px;
            box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
          }

          h1 {
            margin-top: 0;
            color: #16a34a;
          }

          .data {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 18px;
            margin-top: 18px;
          }

          p {
            color: #334155;
            line-height: 1.5;
          }

          a {
            color: #2563eb;
            word-break: break-all;
          }

          .button {
            display: inline-block;
            margin-top: 22px;
            padding: 11px 16px;
            background: #2563eb;
            color: #ffffff;
            text-decoration: none;
            border-radius: 10px;
            font-weight: bold;
          }

          .button:hover {
            background: #1d4ed8;
          }
        </style>
      </head>

      <body>
        <main class="container">
          <h1>Application Submitted</h1>

          <p>
            Data pelamar berhasil disimpan. Dokumen berhasil diunggah ke Amazon S3.
          </p>

          <section class="data">
            <p><strong>Nama:</strong> ${nama}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Nama File:</strong> ${file.originalname}</p>
            <p><strong>URL Dokumen S3:</strong></p>
            <a href="${documentUrl}" target="_blank">${documentUrl}</a>
          </section>

          <a class="button" href="/">Kembali ke Form</a>
          <a class="button" href="/applicants" style="margin-left: 8px; background: #16a34a;">
            Lihat Applicants
          </a>
        </main>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("Error saat memproses pendaftaran:");
    console.error(error);

    res.status(500).send(`
      <h1>Terjadi Error</h1>
      <p>Data gagal diproses.</p>
      <p>${error.message}</p>
      <a href="/">Kembali ke Form</a>
    `);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

// ===============================
// View Applicants Route
// ===============================
app.get("/applicants", async (req, res) => {
  let connection;

  try {
    connection = await getDbConnection();

    const [applicants] = await connection.execute(
      "SELECT id, full_name, email, document_url, created_at FROM applicants ORDER BY created_at DESC"
    );

    const applicantCards = applicants
      .map((applicant) => {
        const documentUrl = applicant.document_url || "";

        const isImage =
          documentUrl.toLowerCase().endsWith(".jpg") ||
          documentUrl.toLowerCase().endsWith(".jpeg") ||
          documentUrl.toLowerCase().endsWith(".png") ||
          documentUrl.toLowerCase().endsWith(".gif") ||
          documentUrl.toLowerCase().endsWith(".webp");

        const documentPreview = isImage
          ? `<img src="${documentUrl}" alt="Dokumen ${applicant.full_name}" class="document-image" />`
          : `
              <div class="document-placeholder">
                <p>Preview tidak tersedia untuk file ini.</p>
                <a href="${documentUrl}" target="_blank">Buka Dokumen</a>
              </div>
            `;

        return `
          <article class="card">
            <div class="card-content">
              <div class="applicant-info">
                <h2>${applicant.full_name}</h2>
                <p><strong>Email:</strong> ${applicant.email}</p>
                <p><strong>Tanggal Submit:</strong> ${new Date(applicant.created_at).toLocaleString("id-ID")}</p>
                <p><strong>URL Dokumen:</strong></p>
                <a href="${documentUrl}" target="_blank" class="document-link">${documentUrl}</a>
              </div>

              <div class="document-preview">
                ${documentPreview}
              </div>
            </div>
          </article>
        `;
      })
      .join("");

    res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Staffora - Applicants</title>

        <style>
          * {
            box-sizing: border-box;
            font-family: Arial, sans-serif;
          }

          body {
            margin: 0;
            min-height: 100vh;
            background: #f8fafc;
            padding: 32px;
          }

          .page {
            width: 100%;
            max-width: 1100px;
            margin: 0 auto;
          }

          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
            margin-bottom: 28px;
          }

          .brand {
            display: flex;
            align-items: center;
            gap: 14px;
          }

          .logo {
            width: 50px;
            height: 50px;
            border-radius: 16px;
            background: #2563eb;
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            font-weight: bold;
          }

          h1 {
            margin: 0;
            color: #0f172a;
            font-size: 28px;
          }

          .subtitle {
            margin: 4px 0 0 0;
            color: #64748b;
            font-size: 14px;
          }

          .back-button {
            padding: 10px 14px;
            background: #2563eb;
            color: #ffffff;
            border-radius: 10px;
            text-decoration: none;
            font-weight: bold;
            font-size: 14px;
          }

          .back-button:hover {
            background: #1d4ed8;
          }

          .summary {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 18px;
            margin-bottom: 20px;
            color: #334155;
            box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
          }

          .card {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 18px;
            padding: 20px;
            margin-bottom: 18px;
            box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
          }

          .card-content {
            display: grid;
            grid-template-columns: 1.4fr 260px;
            gap: 24px;
            align-items: start;
          }

          h2 {
            margin: 0 0 10px 0;
            color: #0f172a;
            font-size: 22px;
          }

          p {
            color: #334155;
            line-height: 1.5;
            margin: 8px 0;
          }

          .document-link {
            color: #2563eb;
            word-break: break-all;
            font-size: 14px;
          }

          .document-preview {
            width: 100%;
          }

          .document-image {
            width: 100%;
            max-height: 260px;
            object-fit: cover;
            border-radius: 14px;
            border: 1px solid #e2e8f0;
            background: #f8fafc;
          }

          .document-placeholder {
            min-height: 180px;
            border-radius: 14px;
            border: 1px dashed #cbd5e1;
            background: #f8fafc;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            padding: 18px;
          }

          .document-placeholder a {
            color: #2563eb;
            font-weight: bold;
          }

          .empty {
            background: #ffffff;
            border: 1px dashed #cbd5e1;
            border-radius: 18px;
            padding: 32px;
            text-align: center;
            color: #64748b;
          }

          @media (max-width: 768px) {
            body {
              padding: 20px;
            }

            .header {
              flex-direction: column;
              align-items: flex-start;
            }

            .card-content {
              grid-template-columns: 1fr;
            }

            .back-button {
              width: 100%;
              text-align: center;
            }
          }
        </style>
      </head>

      <body>
        <main class="page">
          <header class="header">
            <div class="brand">
              <div class="logo">S</div>
              <div>
                <h1>Staffora Applicants</h1>
                <p class="subtitle">Daftar data pelamar yang tersimpan di database</p>
              </div>
            </div>

            <a class="back-button" href="/">Tambah Applicant</a>
          </header>

          <section class="summary">
            <strong>Total applicants:</strong> ${applicants.length}
          </section>

          ${
            applicants.length > 0
              ? applicantCards
              : `
                <section class="empty">
                  <p>Belum ada data applicant yang tersimpan.</p>
                </section>
              `
          }
        </main>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("Error saat mengambil data applicants:");
    console.error(error);

    res.status(500).send(`
      <h1>Terjadi Error</h1>
      <p>Data applicants gagal diambil dari database.</p>
      <p>${error.message}</p>
      <a href="/">Kembali ke Form</a>
    `);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

// ===============================
// Start Server
// ===============================
app.listen(PORT, () => {
  console.log(`Staffora berjalan di http://localhost:${PORT}`);
});