const fs = require('fs');

(async () => {
  console.log("Starting quick clean...");
  const files = fs.readdirSync('.');
  let cleanedCount = 0;
  let deletedCount = 0;

  for (const file of files) {
    if (file.endsWith('.json') && file !== 'package.json' && file !== 'package-lock.json' && file !== 'sync_state.json') {
      try {
        const content = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(content)) {
          const validItems = content.filter(item => item && item.id && String(item.id).trim() !== "");
          
          if (validItems.length === 0) {
            fs.unlinkSync(file);
            deletedCount++;
            console.log(`Deleted empty/bad file: ${file}`);
          } else if (validItems.length < content.length) {
            fs.writeFileSync(file, JSON.stringify(validItems));
            cleanedCount += (content.length - validItems.length);
            console.log(`Cleaned ${content.length - validItems.length} items in: ${file}`);
          }
        }
      } catch (e) {}
    }
  }

  console.log(`\nDone! Removed: ${cleanedCount} bad items. Deleted: ${deletedCount} files.`);
})();
