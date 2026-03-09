I want to implement basic authentication, leveraging supabase. At this stage I'm fine using email/password authtentication with pre-provisioned accounts. The web UI should store authentication tokens locally on the browser to avoid repeating sign in every time. 

Key points off the top of my head:
- WebApp Served by Cloudflare Pages
- WebApp should require login to proceed to game
- Supabase endpoints should require logged in user