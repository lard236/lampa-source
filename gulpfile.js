/** Что-бы все не пропало! **/
process.on('uncaughtException', function (err) {
    console.log(err)
});

const { src, dest, series, parallel } = require('gulp');

var concat         = require('gulp-concat'),
    chokidar       = require('chokidar'),
    uglify         = require('gulp-uglify-es').default,
    uglifycss      = require('gulp-uglifycss'),
    browser        = require('browser-sync').create(),
    newer          = require('gulp-newer'),
    sass           = require('gulp-sass')(require('sass')),
    autoprefixer   = require('gulp-autoprefixer'),
    fileinclude    = require('gulp-file-include'),
    replace        = require('gulp-replace'),
    fs             = require('fs'),
    worker         = require('rollup-plugin-web-worker-loader'),
    crypto         = require('crypto');

var source = require('vinyl-source-stream');
var buffer = require('vinyl-buffer');
var rollup = require('@rollup/stream');
var path   = require('path');
var doctrine = require('doctrine');
var babel = require('@rollup/plugin-babel').babel;
var commonjs = require('@rollup/plugin-commonjs');
var nodeResolve = require('@rollup/plugin-node-resolve');
var regenerator = require('rollup-plugin-regenerator');

var cache;
var srcFolder = './src/';
var dstFolder = './dest/';
var pubFolder = './public/';
var bulFolder = './build/';
var idxFolder = './index/';
var plgFolder = './plugins/';
var docFolder = './build/doc/';
var isDebugEnabled = false;

function merge(done) {
    let plugins = [babel({
        babelHelpers: 'bundled',
        presets: ['@babel/preset-env']
    }), commonjs, nodeResolve, worker()]

    const stream = rollup({
        input: srcFolder+"app.js",
        plugins: plugins,
        output: {
          format: 'iife',
          sourcemap: isDebugEnabled ? 'inline' : false
        },
        onwarn: function (message) {
            return;
        }
    })
    .on('bundle', function(bundle) {})
    .pipe(source('app.js'))
    .pipe(buffer())
    .pipe(replace(/return kIsNodeJS/g, "return false"))
    .pipe(dest(dstFolder));

    stream.on('finish', done);
    stream.on('error', done);
}

function bubbleFile(name, done) {
    let plug = [babel({
        babelHelpers: 'bundled',
        presets: ['@babel/preset-env']
    }), commonjs, nodeResolve]

    const stream = rollup({
        input: plgFolder+name,
        plugins: plug,
        output: {
          format: 'iife',
          sourcemap: isDebugEnabled ? 'inline' : false,
          sourcemapPathTransform: isDebugEnabled ? pluginSourcemapPathTransform : undefined
        },
        onwarn: function (message) {
            return;
        }
    })
    .pipe(source(name))
    .pipe(buffer())
    .pipe(fileinclude({
        prefix: '@@',
        basepath: '@file'
    }))
    .pipe(dest(dstFolder));

    stream.on('finish', done);
    stream.on('error', done);
}

function getFileHash(path) {
    const fileBuffer = fs.readFileSync(path);
    const hashSum = crypto.createHash('md5');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

function plugin_sass(plugin_src){
    return src(plugin_src+'/css/*.scss')
        .pipe(sass.sync().on('error', sass.logError))
        .pipe(autoprefixer(['last 100 versions', '> 1%', 'ie 8', 'ie 7', 'ios 6', 'android 4'], { cascade: true }))
        .pipe(uglifycss({
            "maxLineLen": 80,
            "uglyComments": true
        }))
        .pipe(replace(/\n/g, ''))
        .pipe(replace(/"/g, "'"))
        .pipe(dest(plugin_src+'/css'));
}

function plugins(done) {
    const folders = fs.readdirSync(plgFolder).filter(function (file) {
        return fs.statSync(plgFolder+'/'+file).isDirectory();
    });

    let index = 0;
    function next() {
        if (index >= folders.length) return done();
        const folder = folders[index++];
        const tasks = [];
        tasks.push(function(cb) { bubbleFile(folder+'/'+folder+'.js', cb); });
        tasks.push(plugin_sass(plgFolder+'/'+folder));
        series(tasks)(next);
    }
    next();
}

/** Обновляем файл для WEB */
function build_web(){
    let date = new Date();
    let full_date = date.getFullYear() + '-' +
        ('0' + (date.getMonth()+1)).slice(-2) + '-' +
        ('0' + date.getDate()).slice(-2) + ' ' +
        ('0' + date.getHours()).slice(-2) + ':' +
        ('0' + date.getMinutes()).slice(-2);

    return series(
        function copyApp() {
            return src(dstFolder+'app.js')
                .pipe(replace('{__APP_HASH__}', getFileHash(dstFolder + '/app.js')))
                .pipe(replace('{__APP_BUILD__}', full_date))
                .pipe(dest(bulFolder+'web/'));
        },
        function copyPlugins() {
            const streams = fs.readdirSync(dstFolder)
                .filter(file => fs.statSync(dstFolder+'/'+file).isDirectory())
                .map(folder => src([dstFolder+folder+'/'+folder+'.js']).pipe(dest(bulFolder+'web/plugins')));
            return parallel.apply(null, streams);
        }
    )();
}

function write_manifest(done){
    var manifest = fs.readFileSync(srcFolder+'core/manifest.js', 'utf8')
    var hash = getFileHash(dstFolder + '/app.js')
    var app_version = manifest.match(/app_version: '(.*?)',/)[1]
    var css_version = manifest.match(/css_version: '(.*?)',/)[1]
    var object = {
        app_version: app_version,
        css_version: css_version,
        css_digital: parseInt(css_version.replace(/\./g,'')),
        app_digital: parseInt(app_version.replace(/\./g,'')),
        time: Date.now(),
        hash: hash
    }
    console.log('assembly', object)
    fs.writeFileSync(idxFolder+'github/assembly.json', JSON.stringify(object, null, 4))
    done()
}

function public_task(path){
    return src(dstFolder + '/app.min.js').pipe(dest(bulFolder+path));
}
function lang_task(){
    return src(srcFolder + '/lang/*.js').pipe(dest(pubFolder + '/lang'));
}
function public_webos(){ return public_task('webos/'); }
function public_tizen(){ return public_task('tizen/'); }
function public_github(){ return public_task('github/lampa/'); }
function index_webos(){ return src(idxFolder + '/webos/**/*').pipe(dest(bulFolder+'webos/')); }
function index_tizen(){ return src(idxFolder + '/tizen/**/*').pipe(dest(bulFolder+'tizen/')); }
function index_github(){ return src(idxFolder + '/github/**/*').pipe(dest(bulFolder+'github/lampa/')); }

function sync_task(path){
    return src([pubFolder + '**/*'])
        .pipe(newer(bulFolder+path))
        .pipe(dest(bulFolder+path));
}
function sync_web(){ return sync_task('web/'); }
function sync_webos(){ return sync_task('webos/'); }
function sync_tizen(){ return sync_task('tizen/'); }
function sync_github(){ return sync_task('github/lampa/'); }
function sync_doc(){ return src([idxFolder + 'doc/' + '**/*']).pipe(newer(docFolder)).pipe(dest(docFolder)); }

function watch(done){
    var watcher = chokidar.watch([srcFolder,pubFolder,plgFolder], { persistent: true, ignored: [pubFolder + '/lang']});
    var timer;
    var change = function(path){
        clearTimeout(timer)
        if(path.indexOf('.css') > -1) return;
        timer = setTimeout(series(merge, plugins, sass_task, lang_task, sync_web, build_web),5000)
    }
    watcher.on('add', path => { console.log('File', path, 'has been added'); change(path) })
        .on('change', path => { console.log('File', path, 'has been changed'); change(path) })
        .on('unlink', path => { console.log('File', path, 'has been unlink'); change(path) })
    done();
}

function browser_sync(done) {
    browser.init({ server: { baseDir: bulFolder+'web/' }, open: false, notify: false, ghostMode: false });
    done();
}

function sass_task(){
    return src(srcFolder+'/sass/*.scss')
        .pipe(sass.sync().on('error', sass.logError))
        .pipe(autoprefixer(['last 100 versions', '> 1%', 'ie 8', 'ie 7', 'ios 6', 'android 4'], { cascade: true }))
        .pipe(dest(pubFolder+'/css'));
}

function sass_watch_task(){
    return sass_task().pipe(browser.reload({stream: true}));
}

function uglify_task() {
    let date = new Date();
    let full_date = date.getFullYear() + '-' + ('0' + (date.getMonth()+1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2) + ' ' + ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2);
    return src([dstFolder+'app.js'])
        .pipe(replace('{__APP_HASH__}', getFileHash(dstFolder + '/app.js')))
        .pipe(replace('{__APP_BUILD__}', full_date))
        .pipe(concat('app.min.js')).pipe(dest(dstFolder));
}

function test(done){ lang_task(); done(); }
function enable_debug_mode(done){ console.log('build with sourcemaps!'); isDebugEnabled = true; done(); }
function pluginSourcemapPathTransform(relativeSourcePath, sourcemapPath) {
    const plgFolderLen = plgFolder.length-2;
    return relativeSourcePath.substring(plgFolderLen);
}

function buildDoc(done){
    let data = [];
    function scan(directory){
        fs.readdirSync(directory).forEach(file => {
            let filePath = path.join(directory, file);
            let stat = fs.statSync(filePath);
            if (stat.isDirectory()) scan(filePath);
            else {
                let code = fs.readFileSync(filePath, 'utf8') + '';
                let comments = code.match(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm);
                if(comments) comments.forEach(comment => {
                    let parsedComment = doctrine.parse(comment, { unwrap: true });
                    if(parsedComment.tags.find(t=>t.title == 'doc')) {
                        let params = parsedComment.tags.filter(t=>['doc','name','alias'].indexOf(t.title) == -1);
                        let category = parsedComment.tags.find(t=>t.title == 'alias');
                        let name = parsedComment.tags.find(t=>t.title == 'name');
                        data.push({
                            file: filePath,
                            params: params.map(p=>({param: p.name || p.title, desc: p.description || '', type: p.type ? p.type.name : 'any'})),
                            desc: parsedComment.description,
                            category: category ? category.name : 'other',
                            name: name ? name.name : 'unknown'
                        });
                    }
                });
            }
        });
    }
    scan(srcFolder);
    let doc = fs.readFileSync(idxFolder+'doc/index.html', 'utf8');
    doc = doc.replace('{data}', JSON.stringify(data));
    fs.writeFileSync(docFolder+'data.json', JSON.stringify(data));
    fs.writeFileSync(docFolder+'index.html', doc);
    done();
}

exports.pack_webos = series(sync_webos, uglify_task, public_webos, index_webos);
exports.pack_tizen = series(sync_tizen, uglify_task, public_tizen, index_tizen);
exports.pack_github = series(sync_github, uglify_task, public_github, write_manifest, index_github);
exports.pack_plugins = series(plugins);
exports.test = series(test);
exports.default = parallel(watch, browser_sync);
exports.cloudflare = series(merge, plugins, sass_task, lang_task, sync_web, build_web);
exports.debug = series(enable_debug_mode, this.default);
exports.doc = series(sync_doc, buildDoc);
exports.write_manifest = series(write_manifest);
