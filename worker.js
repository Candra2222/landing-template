export default {
  async fetch(req, env) {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      const { repoFullName, images } = await req.json();

      if (!repoFullName || !Array.isArray(images) || images.length === 0) {
        return Response.json({
          error: "PARAM_REQUIRED",
          example: {
            repoFullName: "username/landing-template",
            images: ["https://example.com/1.jpg"]
          }
        }, { status: 400 });
      }

      /* 1️⃣ Ambil index.html dari GitHub */
      const rawURL = `https://raw.githubusercontent.com/${repoFullName}/main/index.html`;
      const htmlRes = await fetch(rawURL);

      if (!htmlRes.ok) {
        return Response.json({
          error: "HTML_NOT_FOUND",
          rawURL
        }, { status: 404 });
      }

      let html = await htmlRes.text();

      /* 2️⃣ Paksa ganti IMG pertama */
      if (/<img[^>]+src=/.test(html)) {
        html = html.replace(
          /<img([^>]+)src="[^"]*"([^>]*)>/i,
          `<img$1src="${images[0]}"$2>`
        );
      } else {
        html = html.replace(
          "</body>",
          `<img src="${images[0]}" style="max-width:100%">\n</body>`
        );
      }

      /* 3️⃣ Inject rotator */
      if (images.length > 1) {
        html = html.replace("</body>", `
<script>
(() => {
  const IMGS = ${JSON.stringify(images)};
  const img = document.querySelector("img");
  if(!img) return;
  let i = 0;
  setInterval(() => {
    i = (i + 1) % IMGS.length;
    img.src = IMGS[i];
  }, 3000);
})();
</script>
</body>`);
      }

      /* 4️⃣ Buat Cloudflare Pages project */
      const projectName = "site-" + crypto.randomUUID().slice(0, 8);

      const projectRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.CF_API_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: projectName,
            production_branch: "main"
          })
        }
      );

      const project = await projectRes.json();
      if (!project.success) {
        return Response.json(project, { status: 500 });
      }

      /* 5️⃣ Upload file */
      const form = new FormData();
      form.append("index.html", new Blob([html], { type: "text/html" }), "index.html");

      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${projectName}/deployments`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.CF_API_TOKEN}`
          },
          body: form
        }
      );

      return Response.json({
        url: `https://${projectName}.pages.dev`,
        state: "ready"
      });

    } catch (e) {
      return Response.json({
        error: "SERVER_ERROR",
        message: e.message
      }, { status: 500 });
    }
  }
};
