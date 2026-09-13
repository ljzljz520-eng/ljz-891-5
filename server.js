const express = require('express');
const path = require('path');
const { initDb } = require('./src/db');

const PORT = process.env.PORT || 3000;

(async () => {
  await initDb();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.use('/api', require('./src/routes/public'));
  app.use('/api/admin', require('./src/routes/admin'));

  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  app.listen(PORT, () => {
    console.log(`展会入场码查询系统已启动`);
    console.log(`  观众查询页: http://localhost:${PORT}/`);
    console.log(`  管理后台:   http://localhost:${PORT}/admin.html`);
  });
})();
