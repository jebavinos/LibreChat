const fs = require('fs');
const path = require('path');

const directory = path.join(__dirname, '..', 'data');
const retentionDays = process.env.DATA_RETENTION_DAYS || 7;
const now = Date.now();

if (!fs.existsSync(directory)) {
  console.log(`Directory ${directory} does not exist.`);
  process.exit(0);
}

fs.readdir(directory, (err, files) => {
  if (err) {
    console.error(`Error reading directory ${directory}:`, err);
    process.exit(1);
  }

  files.forEach(file => {
    const filePath = path.join(directory, file);
    fs.stat(filePath, (err, stats) => {
      if (err) {
        console.error(`Error getting stats for ${file}:`, err);
        return;
      }

      if (stats.isFile()) {
        const fileAgeDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);
        if (fileAgeDays > retentionDays) {
          fs.unlink(filePath, err => {
            if (err) {
              console.error(`Error deleting ${file}:`, err);
            } else {
              console.log(`Deleted ${file}`);
            }
          });
        }
      }
    });
  });
});
