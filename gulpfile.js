var gulp  = require('gulp');
// including plugins
var uglify = require("gulp-uglify")
, pump = require('pump')
, del = require('del')
, rename = require("gulp-rename");

gulp.task('build', function(cb) {
  pump([
          gulp.src('./js/{event,libs}.js'),
          uglify(),
          rename({ suffix: '.min' }),
          gulp.dest('js/')
      ],
      cb
    );
});

gulp.task('clean',function(cb) {
  del('./js/*.min.js');
  cb();
});

exports.default = gulp.series('clean', 'build')
