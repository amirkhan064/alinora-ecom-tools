# SellerOS

SellerOS is a web application for e-commerce sellers. It combines an Angular frontend with a Node.js and Express backend to provide product catalog, image, shipping-label, and listing tools.

## Features

- **Bulk image downloader** for retrieving product images from supported marketplace listings.
- **Shipping label tools** for scanning, sorting, cropping, and compiling label PDFs. The label processor also supports sorting without cropping.
- **Bulk image cropper** for preparing product photos for marketplace requirements.
- **AI listing and SEO tools** for generating listing content and marketplace-specific SEO data.
- **Watermark remover** for editing product images in the browser.
- **Settlement reconciliation** and a tools dashboard in the SellerOS workspace.
- Public SEO pages for the available tools, with Angular server-side rendering and prerendering configured for production builds.

Marketplace support and output depend on the individual tool and its current implementation.

## Repository Structure

```text
image-downloader/
├── README.md
├── LICENSE
└── seller-os/
    ├── backend/   # Express API, controllers, and processing services
    └── frontend/  # Angular application, public pages, and seller workspace
```

The frontend is an Angular 19 standalone application. Public pages are defined in `seller-os/frontend/src/app/public/`; the seller workspace modules are under `seller-os/frontend/src/app/modules/` and are wired through `seller-os/frontend/src/app/app.routes.ts`.

The backend exposes a JSON and multipart-form API. Controllers are in `seller-os/backend/controllers/`, and shared processing logic is in `seller-os/backend/services/`. The frontend currently sends API requests to `http://localhost:3333`.

## Requirements

- Node.js and npm
- Two terminal sessions when running the frontend and backend together

## Setup

Install dependencies for both applications from the repository root:

```bash
cd seller-os/backend
npm install
```

```bash
cd seller-os/frontend
npm install
```

## Git Commit Identity

Configure the name and email Git records on your commits:

```bash
git config --global user.name "Amir Khan"
git config --global user.email "webmasteramir1@gmail.com"
```

Verify the saved values:

```bash
git config --global --get user.name
git config --global --get user.email
```

The GitHub username (`amirkhan064`) is not a Git config key by itself. GitHub authentication is configured separately.

## Run Locally

Start the backend in one terminal:

```bash
cd seller-os/backend
npm start
```

The API listens on `http://localhost:3333` by default. Set `PORT` to use a different backend port.

Start the frontend in a second terminal:

```bash
cd seller-os/frontend
npm start
```

Open `http://localhost:4200`. The backend CORS configuration allows the local Angular development server on port 4200.

For frontend production compilation, run from `seller-os/frontend/`:

```bash
npm run build
```

## API Endpoints

| Method | Path                        | Purpose                          |
| ------ | --------------------------- | -------------------------------- |
| `GET`  | `/api/health`               | Backend health check             |
| `POST` | `/api/fetch-images`         | Fetch product images             |
| `GET`  | `/api/proxy-image`          | Proxy an image request           |
| `POST` | `/api/labels/process`       | Process uploaded shipping labels |
| `POST` | `/api/labels/scan`          | Scan uploaded shipping labels    |
| `POST` | `/api/seo/generate`         | Generate SEO content             |
| `POST` | `/api/catalog/build`        | Build a product catalog          |
| `POST` | `/api/catalog/refresh-node` | Refresh catalog data             |
| `POST` | `/api/lead/capture`         | Record a lead                    |
| `POST` | `/api/feedback/submit`      | Record feedback                  |

File upload routes use multipart form data. Uploaded files are processed in memory, with a 50 MB per-file limit configured in the backend.

## Environment Configuration

The backend optionally reads `seller-os/backend/.env` at startup. Email delivery for feedback requires SMTP settings; without them, the API still runs and skips sending email notifications.

```dotenv
PORT=3333
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASS=your-app-password
```

Keep credentials and other private configuration out of version control. Do not commit `.env` files or real secrets; the backend's `.gitignore` excludes `seller-os/backend/.env`.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for the full license text.
