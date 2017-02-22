// including plugins
var gulp = require('gulp')
, uglify = require("gulp-uglify")
, rename = require("gulp-rename");
 
// minify task
gulp.task('minify-js', function () {
    gulp.src('./js/*.js') 
    .pipe(uglify())
    .pipe(rename({ suffix: '.min' }))
    .pipe(gulp.dest('js/'));
});

gulp.task('default',['minify-js']);