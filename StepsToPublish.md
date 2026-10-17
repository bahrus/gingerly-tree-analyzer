gingerly-tree must be published first (this extension depends on it).

npm run update
npm run test:all
bump "version" in packages/vscode/package.json, and date the CHANGELOG entry
delete previous *.vsix from directory
npm run package
npx @vscode/vsce publish --packagePath gingerly-tree-analyzer-<version>.vsix
npx ovsx publish gingerly-tree-analyzer-<version>.vsix -p <Open VSX token>

verify on https://marketplace.visualstudio.com/manage/publishers/andersonbruceb
verify on https://open-vsx.org/extension/andersonbruceb/gingerly-tree-analyzer
