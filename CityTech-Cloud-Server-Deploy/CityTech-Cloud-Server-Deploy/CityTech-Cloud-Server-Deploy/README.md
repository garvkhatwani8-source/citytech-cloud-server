# City Tech Cloud Server

This is the permanent shared-data server for the City Tech Windows app and Android APK.

Both apps connect to one hosted URL, for example:

```text
https://citytech-cloud-server.onrender.com
```

The server uses PostgreSQL when `DATABASE_URL` is set. For local testing, it falls back to `data.json`.

## Deploy on Render

1. Create a Render account.
2. Create a new Blueprint from this folder/repo.
3. Render will create:
   - a Node web service
   - a PostgreSQL database
   - the `DATABASE_URL` environment variable
4. After deployment, open:

```text
https://YOUR-RENDER-URL/api/health
```

5. In the Windows app and Android APK, enter the hosted URL as the shared server URL.

## Important

Change the default passwords after first login:

```text
admin / admin123
staff / staff123
```

The current app keeps the same client-side login model as the original app. For sensitive production use, the next upgrade should move authentication fully into the hosted server.
