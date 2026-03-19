# GroceryMate

GroceryMate is a small Express and PostgreSQL app for tracking grocery cash given to a helper, logging spending, and keeping a running balance.

## Features

- Admin and helper login
- Running transaction balance
- Admin-managed transaction types
- Receipt photo upload for transactions
- Mobile-friendly dashboard
- Docker-based local deployment
- Configurable base path, defaulting to `/grocerymate`

## Stack

- Node.js
- Express
- PostgreSQL
- EJS
- JWT authentication
- Multer for receipt uploads
- Docker Compose

## Project Structure

- `server.js` - Express app and API routes
- `public/` - frontend JavaScript and CSS
- `views/` - EJS templates
- `init.sql` - database bootstrap script
- `uploads/receipts/` - uploaded receipt images in local Docker bind-mount setups

## Running With Docker

This is the current way the project is configured to run.

1. Start the containers:

	```bash
	docker-compose up --build
	```

2. Open the app at:

	```text
	http://localhost:2000/grocerymate/
	```

3. Stop the containers without deleting data:

	```bash
	docker-compose down
	```

## Data Persistence

- PostgreSQL data is stored in the Docker named volume `postgres_data`
- Receipt uploads are written to `/app/uploads/receipts` inside the app container
- With the current compose file, `/app` is bind-mounted from the project folder, so receipts are also present in `uploads/receipts/` in this repo folder

Important:

- `docker-compose down` keeps the database volume
- `docker-compose down -v` deletes the database volume
- deleting the `uploads/` folder removes locally stored receipt files

## Deployment Checklist

Use this when updating the app on a machine that already has the project checked out.

1. Pull the latest changes:

	```bash
	git pull origin main
	```

2. Rebuild and restart the containers:

	```bash
	docker-compose up --build -d
	```

3. Confirm the app started cleanly:

	```bash
	docker-compose logs app --tail=50
	```

4. Open the app:

	```text
	http://localhost:2000/grocerymate/
	```

5. Do not use `docker-compose down -v` unless you intentionally want to delete the database volume.

6. If you need a clean stop without deleting data:

	```bash
	docker-compose down
	```

## Local Development Without Docker

1. Install dependencies:

	```bash
	npm install
	```

2. Create environment variables for PostgreSQL and JWT. The app reads:

	- `PORT`
	- `BASE_PATH`
	- `DB_HOST`
	- `DB_PORT`
	- `DB_NAME`
	- `DB_USER`
	- `DB_PASSWORD`
	- `JWT_SECRET`

3. Initialize the database with `init.sql`

4. Start the app:

	```bash
	npm start
	```

For auto-reload during development:

```bash
npm run dev
```

## Notes About Transactions

- Admin cash entries are stored as `given` for compatibility and displayed as `cash` in the UI
- Helpers can add expense transactions and upload a receipt image
- Receipt images are compressed in the browser before upload

## Before Pushing To GitHub

The repository is set up to ignore:

- `node_modules/`
- `.env`
- `uploads/`
- local backup files
- editor and OS-generated files

That keeps secrets, uploaded receipts, and machine-specific files out of Git.