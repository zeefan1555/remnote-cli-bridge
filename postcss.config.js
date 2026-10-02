module.exports = () => {
  return {
    plugins: [require('postcss-import'), require('@tailwindcss/postcss'), require('autoprefixer')],
  };
};
