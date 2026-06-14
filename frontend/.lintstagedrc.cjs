module.exports = {
  'src/**/!(*.gen).{ts,tsx}': ['eslint --max-warnings 0', 'prettier --write'],
}
