// Azure Functions v4 entry point — imports each handler so app.http(...)
// and app.timer(...) registrations run at module-load time. Add new
// handlers here.
import "./collect/index.js";
import "./daily/index.js";
import "./summary/index.js";
