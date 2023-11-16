#!/bin/bash
rm /mnt/c/Users/dddma/OneDrive/Apps/remotely-save/Test/.obsidian/plugins/obsidian-kanban/.hotreload
npm run build
touch dist/.hotreload
echo $(cat dist/main.js | md5sum) > dist/.hotreload
cp -a dist/. /mnt/c/Users/dddma/OneDrive/Apps/remotely-save/Test/.obsidian/plugins/obsidian-kanban/