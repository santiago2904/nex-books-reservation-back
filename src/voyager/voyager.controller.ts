import { Controller, Get, Header, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';

@Controller('voyager')
export class VoyagerController {
  @Public()
  @Get()
  @Header('Content-Type', 'text/html')
  serve(@Res() res: Response) {
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Nex Books — Schema Explorer</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/graphql-voyager@2/dist/voyager.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f1f5f9; }
    #voyager { height: 100dvh; padding-top: 48px; }
    .header {
      position: fixed; top: 0; left: 0; right: 0; z-index: 100;
      background: #0f172a; border-bottom: 1px solid #1e293b;
      padding: 12px 24px; display: flex; align-items: center; gap: 12px;
    }
    .header h1 { font-size: 15px; font-weight: 600; font-family: Georgia, serif; }
    .header span { color: #64748b; font-size: 12px; }
    .status { color: #64748b; font-size: 12px; margin-left: auto; }
    .status.ok { color: #4ade80; }
    .status.err { color: #f87171; }
    /* login overlay */
    #overlay {
      position: fixed; inset: 0; z-index: 200;
      background: #0f172a; display: flex; align-items: center; justify-content: center;
    }
    #overlay.hidden { display: none; }
    .login-card {
      background: #1e293b; border: 1px solid #334155; border-radius: 16px;
      padding: 32px; width: 360px;
    }
    .login-card h2 { font-family: Georgia, serif; font-size: 20px; margin-bottom: 8px; }
    .login-card p { color: #94a3b8; font-size: 13px; margin-bottom: 24px; }
    .field { margin-bottom: 16px; }
    .field label { display: block; font-size: 12px; color: #94a3b8; margin-bottom: 6px; }
    .field input {
      width: 100%; padding: 10px 12px; border-radius: 10px;
      border: 1px solid #334155; background: #0f172a; color: #f1f5f9;
      font-size: 14px; outline: none;
    }
    .field input:focus { border-color: #64748b; }
    .btn {
      width: 100%; padding: 11px; border-radius: 10px;
      background: #f1f5f9; color: #0f172a; font-weight: 600;
      font-size: 14px; border: none; cursor: pointer; margin-top: 8px;
    }
    .btn:hover { background: #e2e8f0; }
    .err-msg { color: #f87171; font-size: 12px; margin-top: 10px; text-align: center; }
  </style>
</head>
<body>

  <!-- login overlay -->
  <div id="overlay">
    <div class="login-card">
      <h2>Schema Explorer</h2>
      <p>Inicia sesión para cargar el esquema GraphQL.</p>
      <div class="field">
        <label>Correo</label>
        <input id="email" type="email" value="admin@nex.test" />
      </div>
      <div class="field">
        <label>Contraseña</label>
        <input id="password" type="password" value="Admin123!" />
      </div>
      <button class="btn" onclick="doLogin()">Ver esquema</button>
      <div class="err-msg" id="err"></div>
    </div>
  </div>

  <!-- app -->
  <div class="header">
    <h1>Nex Books</h1>
    <span>GraphQL Schema Explorer</span>
    <span class="status" id="status"></span>
  </div>
  <div id="voyager">Cargando…</div>

  <script src="https://cdn.jsdelivr.net/npm/graphql-voyager@2/dist/voyager.standalone.js"></script>
  <script>
    var token = '';

    function gql(query, variables) {
      return fetch('/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        },
        body: JSON.stringify({ query: query, variables: variables }),
      }).then(function(r) { return r.json(); });
    }

    function doLogin() {
      var email = document.getElementById('email').value;
      var pass  = document.getElementById('password').value;
      document.getElementById('err').textContent = '';
      gql('mutation($i: LoginInput!) { login(input: $i) { accessToken } }', { i: { email: email, password: pass } })
        .then(function(data) {
          if (data.errors || !data.data) {
            document.getElementById('err').textContent = 'Credenciales incorrectas.';
            return;
          }
          token = data.data.login.accessToken;
          document.getElementById('overlay').classList.add('hidden');
          document.getElementById('status').textContent = '● conectado';
          document.getElementById('status').classList.add('ok');
          renderVoyager();
        })
        .catch(function() {
          document.getElementById('err').textContent = 'No se pudo conectar al servidor.';
        });
    }

    function renderVoyager() {
      GraphQLVoyager.renderVoyager(document.getElementById('voyager'), {
        introspection: function(query) { return gql(query); },
      });
    }

    // Allow submitting with Enter key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !document.getElementById('overlay').classList.contains('hidden')) {
        doLogin();
      }
    });
  </script>
</body>
</html>`);
  }
}
