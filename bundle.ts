function deferred() {
    let methods;
    const promise = new Promise((resolve, reject)=>{
        methods = {
            resolve,
            reject
        };
    });
    return Object.assign(promise, methods);
}
class MuxAsyncIterator {
    iteratorCount = 0;
    yields = [];
    throws = [];
    signal = deferred();
    add(iterable) {
        ++this.iteratorCount;
        this.callIteratorNext(iterable[Symbol.asyncIterator]());
    }
    async callIteratorNext(iterator) {
        try {
            const { value , done  } = await iterator.next();
            if (done) {
                --this.iteratorCount;
            } else {
                this.yields.push({
                    iterator,
                    value
                });
            }
        } catch (e) {
            this.throws.push(e);
        }
        this.signal.resolve();
    }
    async *iterate() {
        while(this.iteratorCount > 0){
            await this.signal;
            for(let i = 0; i < this.yields.length; i++){
                const { iterator , value  } = this.yields[i];
                yield value;
                this.callIteratorNext(iterator);
            }
            if (this.throws.length) {
                for (const e of this.throws){
                    throw e;
                }
                this.throws.length = 0;
            }
            this.yields.length = 0;
            this.signal = deferred();
        }
    }
    [Symbol.asyncIterator]() {
        return this.iterate();
    }
}
const noop = ()=>{
};
class AsyncIterableClone {
    currentPromise;
    resolveCurrent = noop;
    consumed;
    consume = noop;
    constructor(){
        this.currentPromise = new Promise((resolve)=>{
            this.resolveCurrent = resolve;
        });
        this.consumed = new Promise((resolve)=>{
            this.consume = resolve;
        });
    }
    reset() {
        this.currentPromise = new Promise((resolve)=>{
            this.resolveCurrent = resolve;
        });
        this.consumed = new Promise((resolve)=>{
            this.consume = resolve;
        });
    }
    async next() {
        const res = await this.currentPromise;
        this.consume();
        this.reset();
        return res;
    }
    async push(res) {
        this.resolveCurrent(res);
        await this.consumed;
    }
    [Symbol.asyncIterator]() {
        return this;
    }
}
function concat(...buf) {
    let length = 0;
    for (const b of buf){
        length += b.length;
    }
    const output = new Uint8Array(length);
    let index = 0;
    for (const b1 of buf){
        output.set(b1, index);
        index += b1.length;
    }
    return output;
}
function copy(src, dst, off = 0) {
    off = Math.max(0, Math.min(off, dst.byteLength));
    const dstBytesAvailable = dst.byteLength - off;
    if (src.byteLength > dstBytesAvailable) {
        src = src.subarray(0, dstBytesAvailable);
    }
    dst.set(src, off);
    return src.byteLength;
}
class DenoStdInternalError extends Error {
    constructor(message){
        super(message);
        this.name = "DenoStdInternalError";
    }
}
function assert(expr, msg = "") {
    if (!expr) {
        throw new DenoStdInternalError(msg);
    }
}
const MIN_READ = 32 * 1024;
const MAX_SIZE = 2 ** 32 - 2;
class Buffer {
    #buf;
    #off = 0;
    constructor(ab){
        this.#buf = ab === undefined ? new Uint8Array(0) : new Uint8Array(ab);
    }
    bytes(options = {
        copy: true
    }) {
        if (options.copy === false) return this.#buf.subarray(this.#off);
        return this.#buf.slice(this.#off);
    }
    empty() {
        return this.#buf.byteLength <= this.#off;
    }
    get length() {
        return this.#buf.byteLength - this.#off;
    }
    get capacity() {
        return this.#buf.buffer.byteLength;
    }
    truncate(n) {
        if (n === 0) {
            this.reset();
            return;
        }
        if (n < 0 || n > this.length) {
            throw Error("bytes.Buffer: truncation out of range");
        }
        this.#reslice(this.#off + n);
    }
    reset() {
        this.#reslice(0);
        this.#off = 0;
    }
     #tryGrowByReslice(n) {
        const l = this.#buf.byteLength;
        if (n <= this.capacity - l) {
            this.#reslice(l + n);
            return l;
        }
        return -1;
    }
     #reslice(len) {
        assert(len <= this.#buf.buffer.byteLength);
        this.#buf = new Uint8Array(this.#buf.buffer, 0, len);
    }
    readSync(p) {
        if (this.empty()) {
            this.reset();
            if (p.byteLength === 0) {
                return 0;
            }
            return null;
        }
        const nread = copy(this.#buf.subarray(this.#off), p);
        this.#off += nread;
        return nread;
    }
    read(p) {
        const rr = this.readSync(p);
        return Promise.resolve(rr);
    }
    writeSync(p) {
        const m = this.#grow(p.byteLength);
        return copy(p, this.#buf, m);
    }
    write(p) {
        const n = this.writeSync(p);
        return Promise.resolve(n);
    }
     #grow(n) {
        const m = this.length;
        if (m === 0 && this.#off !== 0) {
            this.reset();
        }
        const i = this.#tryGrowByReslice(n);
        if (i >= 0) {
            return i;
        }
        const c = this.capacity;
        if (n <= Math.floor(c / 2) - m) {
            copy(this.#buf.subarray(this.#off), this.#buf);
        } else if (c + n > MAX_SIZE) {
            throw new Error("The buffer cannot be grown beyond the maximum size.");
        } else {
            const buf = new Uint8Array(Math.min(2 * c + n, MAX_SIZE));
            copy(this.#buf.subarray(this.#off), buf);
            this.#buf = buf;
        }
        this.#off = 0;
        this.#reslice(Math.min(m + n, MAX_SIZE));
        return m;
    }
    grow(n) {
        if (n < 0) {
            throw Error("Buffer.grow: negative count");
        }
        const m = this.#grow(n);
        this.#reslice(m);
    }
    async readFrom(r) {
        let n = 0;
        const tmp = new Uint8Array(MIN_READ);
        while(true){
            const shouldGrow = this.capacity - this.length < MIN_READ;
            const buf = shouldGrow ? tmp : new Uint8Array(this.#buf.buffer, this.length);
            const nread = await r.read(buf);
            if (nread === null) {
                return n;
            }
            if (shouldGrow) this.writeSync(buf.subarray(0, nread));
            else this.#reslice(this.length + nread);
            n += nread;
        }
    }
    readFromSync(r) {
        let n = 0;
        const tmp = new Uint8Array(MIN_READ);
        while(true){
            const shouldGrow = this.capacity - this.length < MIN_READ;
            const buf = shouldGrow ? tmp : new Uint8Array(this.#buf.buffer, this.length);
            const nread = r.readSync(buf);
            if (nread === null) {
                return n;
            }
            if (shouldGrow) this.writeSync(buf.subarray(0, nread));
            else this.#reslice(this.length + nread);
            n += nread;
        }
    }
}
const ANSI_PATTERN = new RegExp([
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))", 
].join("|"), "g");
var DiffType;
(function(DiffType1) {
    DiffType1["removed"] = "removed";
    DiffType1["common"] = "common";
    DiffType1["added"] = "added";
})(DiffType || (DiffType = {
}));
class AssertionError extends Error {
    constructor(message1){
        super(message1);
        this.name = "AssertionError";
    }
}
const DEFAULT_BUFFER_SIZE = 32 * 1024;
async function writeAll(w, arr) {
    let nwritten = 0;
    while(nwritten < arr.length){
        nwritten += await w.write(arr.subarray(nwritten));
    }
}
function writeAllSync(w, arr) {
    let nwritten = 0;
    while(nwritten < arr.length){
        nwritten += w.writeSync(arr.subarray(nwritten));
    }
}
async function* iter(r, options) {
    const bufSize = options?.bufSize ?? DEFAULT_BUFFER_SIZE;
    const b = new Uint8Array(bufSize);
    while(true){
        const result = await r.read(b);
        if (result === null) {
            break;
        }
        yield b.subarray(0, result);
    }
}
const CHAR_SPACE = " ".charCodeAt(0);
const CHAR_TAB = "\t".charCodeAt(0);
const CHAR_COLON = ":".charCodeAt(0);
const WHITESPACES = [
    CHAR_SPACE,
    CHAR_TAB
];
const decoder = new TextDecoder();
const invalidHeaderCharRegex = /[^\t\x20-\x7e\x80-\xff]/g;
function str(buf) {
    return !buf ? "" : decoder.decode(buf);
}
class TextProtoReader {
    r;
    constructor(r1){
        this.r = r1;
    }
    async readLine() {
        const s = await this.readLineSlice();
        return s === null ? null : str(s);
    }
    async readMIMEHeader() {
        const m = new Headers();
        let line;
        let buf = await this.r.peek(1);
        if (buf === null) {
            return null;
        } else if (WHITESPACES.includes(buf[0])) {
            line = await this.readLineSlice();
        }
        buf = await this.r.peek(1);
        if (buf === null) {
            throw new Deno.errors.UnexpectedEof();
        } else if (WHITESPACES.includes(buf[0])) {
            throw new Deno.errors.InvalidData(`malformed MIME header initial line: ${str(line)}`);
        }
        while(true){
            const kv = await this.readLineSlice();
            if (kv === null) throw new Deno.errors.UnexpectedEof();
            if (kv.byteLength === 0) return m;
            let i = kv.indexOf(CHAR_COLON);
            if (i < 0) {
                throw new Deno.errors.InvalidData(`malformed MIME header line: ${str(kv)}`);
            }
            const key = str(kv.subarray(0, i));
            if (key == "") {
                continue;
            }
            i++;
            while(i < kv.byteLength && WHITESPACES.includes(kv[i])){
                i++;
            }
            const value = str(kv.subarray(i)).replace(invalidHeaderCharRegex, encodeURI);
            try {
                m.append(key, value);
            } catch  {
            }
        }
    }
    async readLineSlice() {
        let line = new Uint8Array(0);
        let r1 = null;
        do {
            r1 = await this.r.readLine();
            if (r1 !== null && this.skipSpace(r1.line) !== 0) {
                line = concat(line, r1.line);
            }
        }while (r1 !== null && r1.more)
        return r1 === null ? null : line;
    }
    skipSpace(l) {
        let n = 0;
        for (const val of l){
            if (!WHITESPACES.includes(val)) {
                n++;
            }
        }
        return n;
    }
}
var Status;
(function(Status1) {
    Status1[Status1["Continue"] = 100] = "Continue";
    Status1[Status1["SwitchingProtocols"] = 101] = "SwitchingProtocols";
    Status1[Status1["Processing"] = 102] = "Processing";
    Status1[Status1["EarlyHints"] = 103] = "EarlyHints";
    Status1[Status1["OK"] = 200] = "OK";
    Status1[Status1["Created"] = 201] = "Created";
    Status1[Status1["Accepted"] = 202] = "Accepted";
    Status1[Status1["NonAuthoritativeInfo"] = 203] = "NonAuthoritativeInfo";
    Status1[Status1["NoContent"] = 204] = "NoContent";
    Status1[Status1["ResetContent"] = 205] = "ResetContent";
    Status1[Status1["PartialContent"] = 206] = "PartialContent";
    Status1[Status1["MultiStatus"] = 207] = "MultiStatus";
    Status1[Status1["AlreadyReported"] = 208] = "AlreadyReported";
    Status1[Status1["IMUsed"] = 226] = "IMUsed";
    Status1[Status1["MultipleChoices"] = 300] = "MultipleChoices";
    Status1[Status1["MovedPermanently"] = 301] = "MovedPermanently";
    Status1[Status1["Found"] = 302] = "Found";
    Status1[Status1["SeeOther"] = 303] = "SeeOther";
    Status1[Status1["NotModified"] = 304] = "NotModified";
    Status1[Status1["UseProxy"] = 305] = "UseProxy";
    Status1[Status1["TemporaryRedirect"] = 307] = "TemporaryRedirect";
    Status1[Status1["PermanentRedirect"] = 308] = "PermanentRedirect";
    Status1[Status1["BadRequest"] = 400] = "BadRequest";
    Status1[Status1["Unauthorized"] = 401] = "Unauthorized";
    Status1[Status1["PaymentRequired"] = 402] = "PaymentRequired";
    Status1[Status1["Forbidden"] = 403] = "Forbidden";
    Status1[Status1["NotFound"] = 404] = "NotFound";
    Status1[Status1["MethodNotAllowed"] = 405] = "MethodNotAllowed";
    Status1[Status1["NotAcceptable"] = 406] = "NotAcceptable";
    Status1[Status1["ProxyAuthRequired"] = 407] = "ProxyAuthRequired";
    Status1[Status1["RequestTimeout"] = 408] = "RequestTimeout";
    Status1[Status1["Conflict"] = 409] = "Conflict";
    Status1[Status1["Gone"] = 410] = "Gone";
    Status1[Status1["LengthRequired"] = 411] = "LengthRequired";
    Status1[Status1["PreconditionFailed"] = 412] = "PreconditionFailed";
    Status1[Status1["RequestEntityTooLarge"] = 413] = "RequestEntityTooLarge";
    Status1[Status1["RequestURITooLong"] = 414] = "RequestURITooLong";
    Status1[Status1["UnsupportedMediaType"] = 415] = "UnsupportedMediaType";
    Status1[Status1["RequestedRangeNotSatisfiable"] = 416] = "RequestedRangeNotSatisfiable";
    Status1[Status1["ExpectationFailed"] = 417] = "ExpectationFailed";
    Status1[Status1["Teapot"] = 418] = "Teapot";
    Status1[Status1["MisdirectedRequest"] = 421] = "MisdirectedRequest";
    Status1[Status1["UnprocessableEntity"] = 422] = "UnprocessableEntity";
    Status1[Status1["Locked"] = 423] = "Locked";
    Status1[Status1["FailedDependency"] = 424] = "FailedDependency";
    Status1[Status1["TooEarly"] = 425] = "TooEarly";
    Status1[Status1["UpgradeRequired"] = 426] = "UpgradeRequired";
    Status1[Status1["PreconditionRequired"] = 428] = "PreconditionRequired";
    Status1[Status1["TooManyRequests"] = 429] = "TooManyRequests";
    Status1[Status1["RequestHeaderFieldsTooLarge"] = 431] = "RequestHeaderFieldsTooLarge";
    Status1[Status1["UnavailableForLegalReasons"] = 451] = "UnavailableForLegalReasons";
    Status1[Status1["InternalServerError"] = 500] = "InternalServerError";
    Status1[Status1["NotImplemented"] = 501] = "NotImplemented";
    Status1[Status1["BadGateway"] = 502] = "BadGateway";
    Status1[Status1["ServiceUnavailable"] = 503] = "ServiceUnavailable";
    Status1[Status1["GatewayTimeout"] = 504] = "GatewayTimeout";
    Status1[Status1["HTTPVersionNotSupported"] = 505] = "HTTPVersionNotSupported";
    Status1[Status1["VariantAlsoNegotiates"] = 506] = "VariantAlsoNegotiates";
    Status1[Status1["InsufficientStorage"] = 507] = "InsufficientStorage";
    Status1[Status1["LoopDetected"] = 508] = "LoopDetected";
    Status1[Status1["NotExtended"] = 510] = "NotExtended";
    Status1[Status1["NetworkAuthenticationRequired"] = 511] = "NetworkAuthenticationRequired";
})(Status || (Status = {
}));
const STATUS_TEXT = new Map([
    [
        Status.Continue,
        "Continue"
    ],
    [
        Status.SwitchingProtocols,
        "Switching Protocols"
    ],
    [
        Status.Processing,
        "Processing"
    ],
    [
        Status.EarlyHints,
        "Early Hints"
    ],
    [
        Status.OK,
        "OK"
    ],
    [
        Status.Created,
        "Created"
    ],
    [
        Status.Accepted,
        "Accepted"
    ],
    [
        Status.NonAuthoritativeInfo,
        "Non-Authoritative Information"
    ],
    [
        Status.NoContent,
        "No Content"
    ],
    [
        Status.ResetContent,
        "Reset Content"
    ],
    [
        Status.PartialContent,
        "Partial Content"
    ],
    [
        Status.MultiStatus,
        "Multi-Status"
    ],
    [
        Status.AlreadyReported,
        "Already Reported"
    ],
    [
        Status.IMUsed,
        "IM Used"
    ],
    [
        Status.MultipleChoices,
        "Multiple Choices"
    ],
    [
        Status.MovedPermanently,
        "Moved Permanently"
    ],
    [
        Status.Found,
        "Found"
    ],
    [
        Status.SeeOther,
        "See Other"
    ],
    [
        Status.NotModified,
        "Not Modified"
    ],
    [
        Status.UseProxy,
        "Use Proxy"
    ],
    [
        Status.TemporaryRedirect,
        "Temporary Redirect"
    ],
    [
        Status.PermanentRedirect,
        "Permanent Redirect"
    ],
    [
        Status.BadRequest,
        "Bad Request"
    ],
    [
        Status.Unauthorized,
        "Unauthorized"
    ],
    [
        Status.PaymentRequired,
        "Payment Required"
    ],
    [
        Status.Forbidden,
        "Forbidden"
    ],
    [
        Status.NotFound,
        "Not Found"
    ],
    [
        Status.MethodNotAllowed,
        "Method Not Allowed"
    ],
    [
        Status.NotAcceptable,
        "Not Acceptable"
    ],
    [
        Status.ProxyAuthRequired,
        "Proxy Authentication Required"
    ],
    [
        Status.RequestTimeout,
        "Request Timeout"
    ],
    [
        Status.Conflict,
        "Conflict"
    ],
    [
        Status.Gone,
        "Gone"
    ],
    [
        Status.LengthRequired,
        "Length Required"
    ],
    [
        Status.PreconditionFailed,
        "Precondition Failed"
    ],
    [
        Status.RequestEntityTooLarge,
        "Request Entity Too Large"
    ],
    [
        Status.RequestURITooLong,
        "Request URI Too Long"
    ],
    [
        Status.UnsupportedMediaType,
        "Unsupported Media Type"
    ],
    [
        Status.RequestedRangeNotSatisfiable,
        "Requested Range Not Satisfiable"
    ],
    [
        Status.ExpectationFailed,
        "Expectation Failed"
    ],
    [
        Status.Teapot,
        "I'm a teapot"
    ],
    [
        Status.MisdirectedRequest,
        "Misdirected Request"
    ],
    [
        Status.UnprocessableEntity,
        "Unprocessable Entity"
    ],
    [
        Status.Locked,
        "Locked"
    ],
    [
        Status.FailedDependency,
        "Failed Dependency"
    ],
    [
        Status.TooEarly,
        "Too Early"
    ],
    [
        Status.UpgradeRequired,
        "Upgrade Required"
    ],
    [
        Status.PreconditionRequired,
        "Precondition Required"
    ],
    [
        Status.TooManyRequests,
        "Too Many Requests"
    ],
    [
        Status.RequestHeaderFieldsTooLarge,
        "Request Header Fields Too Large"
    ],
    [
        Status.UnavailableForLegalReasons,
        "Unavailable For Legal Reasons"
    ],
    [
        Status.InternalServerError,
        "Internal Server Error"
    ],
    [
        Status.NotImplemented,
        "Not Implemented"
    ],
    [
        Status.BadGateway,
        "Bad Gateway"
    ],
    [
        Status.ServiceUnavailable,
        "Service Unavailable"
    ],
    [
        Status.GatewayTimeout,
        "Gateway Timeout"
    ],
    [
        Status.HTTPVersionNotSupported,
        "HTTP Version Not Supported"
    ],
    [
        Status.VariantAlsoNegotiates,
        "Variant Also Negotiates"
    ],
    [
        Status.InsufficientStorage,
        "Insufficient Storage"
    ],
    [
        Status.LoopDetected,
        "Loop Detected"
    ],
    [
        Status.NotExtended,
        "Not Extended"
    ],
    [
        Status.NetworkAuthenticationRequired,
        "Network Authentication Required"
    ], 
]);
const encoder = new TextEncoder();
function emptyReader() {
    return {
        read (_) {
            return Promise.resolve(null);
        }
    };
}
function bodyReader(contentLength, r1) {
    let totalRead = 0;
    let finished = false;
    async function read(buf) {
        if (finished) return null;
        let result;
        const remaining = contentLength - totalRead;
        if (remaining >= buf.byteLength) {
            result = await r1.read(buf);
        } else {
            const readBuf = buf.subarray(0, remaining);
            result = await r1.read(readBuf);
        }
        if (result !== null) {
            totalRead += result;
        }
        finished = totalRead === contentLength;
        return result;
    }
    return {
        read
    };
}
function chunkedBodyReader(h, r1) {
    const tp = new TextProtoReader(r1);
    let finished = false;
    const chunks = [];
    async function read(buf) {
        if (finished) return null;
        const [chunk] = chunks;
        if (chunk) {
            const chunkRemaining = chunk.data.byteLength - chunk.offset;
            const readLength = Math.min(chunkRemaining, buf.byteLength);
            for(let i = 0; i < readLength; i++){
                buf[i] = chunk.data[chunk.offset + i];
            }
            chunk.offset += readLength;
            if (chunk.offset === chunk.data.byteLength) {
                chunks.shift();
                if (await tp.readLine() === null) {
                    throw new Deno.errors.UnexpectedEof();
                }
            }
            return readLength;
        }
        const line = await tp.readLine();
        if (line === null) throw new Deno.errors.UnexpectedEof();
        const [chunkSizeString] = line.split(";");
        const chunkSize = parseInt(chunkSizeString, 16);
        if (Number.isNaN(chunkSize) || chunkSize < 0) {
            throw new Deno.errors.InvalidData("Invalid chunk size");
        }
        if (chunkSize > 0) {
            if (chunkSize > buf.byteLength) {
                let eof = await r1.readFull(buf);
                if (eof === null) {
                    throw new Deno.errors.UnexpectedEof();
                }
                const restChunk = new Uint8Array(chunkSize - buf.byteLength);
                eof = await r1.readFull(restChunk);
                if (eof === null) {
                    throw new Deno.errors.UnexpectedEof();
                } else {
                    chunks.push({
                        offset: 0,
                        data: restChunk
                    });
                }
                return buf.byteLength;
            } else {
                const bufToFill = buf.subarray(0, chunkSize);
                const eof = await r1.readFull(bufToFill);
                if (eof === null) {
                    throw new Deno.errors.UnexpectedEof();
                }
                if (await tp.readLine() === null) {
                    throw new Deno.errors.UnexpectedEof();
                }
                return chunkSize;
            }
        } else {
            assert(chunkSize === 0);
            if (await r1.readLine() === null) {
                throw new Deno.errors.UnexpectedEof();
            }
            await readTrailers(h, r1);
            finished = true;
            return null;
        }
    }
    return {
        read
    };
}
const DEFAULT_BUF_SIZE = 4096;
const MIN_BUF_SIZE = 16;
const CR = "\r".charCodeAt(0);
const LF = "\n".charCodeAt(0);
class BufferFullError extends Error {
    partial;
    name = "BufferFullError";
    constructor(partial1){
        super("Buffer full");
        this.partial = partial1;
    }
}
class PartialReadError extends Error {
    name = "PartialReadError";
    partial;
    constructor(){
        super("Encountered UnexpectedEof, data only partially read");
    }
}
class BufReader {
    buf;
    rd;
    r = 0;
    w = 0;
    eof = false;
    static create(r, size = 4096) {
        return r instanceof BufReader ? r : new BufReader(r, size);
    }
    constructor(rd1, size1 = 4096){
        if (size1 < 16) {
            size1 = MIN_BUF_SIZE;
        }
        this._reset(new Uint8Array(size1), rd1);
    }
    size() {
        return this.buf.byteLength;
    }
    buffered() {
        return this.w - this.r;
    }
    async _fill() {
        if (this.r > 0) {
            this.buf.copyWithin(0, this.r, this.w);
            this.w -= this.r;
            this.r = 0;
        }
        if (this.w >= this.buf.byteLength) {
            throw Error("bufio: tried to fill full buffer");
        }
        for(let i = 100; i > 0; i--){
            const rr = await this.rd.read(this.buf.subarray(this.w));
            if (rr === null) {
                this.eof = true;
                return;
            }
            assert(rr >= 0, "negative read");
            this.w += rr;
            if (rr > 0) {
                return;
            }
        }
        throw new Error(`No progress after ${100} read() calls`);
    }
    reset(r) {
        this._reset(this.buf, r);
    }
    _reset(buf, rd) {
        this.buf = buf;
        this.rd = rd;
        this.eof = false;
    }
    async read(p) {
        let rr = p.byteLength;
        if (p.byteLength === 0) return rr;
        if (this.r === this.w) {
            if (p.byteLength >= this.buf.byteLength) {
                const rr1 = await this.rd.read(p);
                const nread = rr1 ?? 0;
                assert(nread >= 0, "negative read");
                return rr1;
            }
            this.r = 0;
            this.w = 0;
            rr = await this.rd.read(this.buf);
            if (rr === 0 || rr === null) return rr;
            assert(rr >= 0, "negative read");
            this.w += rr;
        }
        const copied = copy(this.buf.subarray(this.r, this.w), p, 0);
        this.r += copied;
        return copied;
    }
    async readFull(p) {
        let bytesRead = 0;
        while(bytesRead < p.length){
            try {
                const rr = await this.read(p.subarray(bytesRead));
                if (rr === null) {
                    if (bytesRead === 0) {
                        return null;
                    } else {
                        throw new PartialReadError();
                    }
                }
                bytesRead += rr;
            } catch (err) {
                err.partial = p.subarray(0, bytesRead);
                throw err;
            }
        }
        return p;
    }
    async readByte() {
        while(this.r === this.w){
            if (this.eof) return null;
            await this._fill();
        }
        const c = this.buf[this.r];
        this.r++;
        return c;
    }
    async readString(delim) {
        if (delim.length !== 1) {
            throw new Error("Delimiter should be a single character");
        }
        const buffer = await this.readSlice(delim.charCodeAt(0));
        if (buffer === null) return null;
        return new TextDecoder().decode(buffer);
    }
    async readLine() {
        let line;
        try {
            line = await this.readSlice(LF);
        } catch (err) {
            let { partial: partial2  } = err;
            assert(partial2 instanceof Uint8Array, "bufio: caught error from `readSlice()` without `partial` property");
            if (!(err instanceof BufferFullError)) {
                throw err;
            }
            if (!this.eof && partial2.byteLength > 0 && partial2[partial2.byteLength - 1] === CR) {
                assert(this.r > 0, "bufio: tried to rewind past start of buffer");
                this.r--;
                partial2 = partial2.subarray(0, partial2.byteLength - 1);
            }
            return {
                line: partial2,
                more: !this.eof
            };
        }
        if (line === null) {
            return null;
        }
        if (line.byteLength === 0) {
            return {
                line,
                more: false
            };
        }
        if (line[line.byteLength - 1] == LF) {
            let drop = 1;
            if (line.byteLength > 1 && line[line.byteLength - 2] === CR) {
                drop = 2;
            }
            line = line.subarray(0, line.byteLength - drop);
        }
        return {
            line,
            more: false
        };
    }
    async readSlice(delim) {
        let s = 0;
        let slice;
        while(true){
            let i = this.buf.subarray(this.r + s, this.w).indexOf(delim);
            if (i >= 0) {
                i += s;
                slice = this.buf.subarray(this.r, this.r + i + 1);
                this.r += i + 1;
                break;
            }
            if (this.eof) {
                if (this.r === this.w) {
                    return null;
                }
                slice = this.buf.subarray(this.r, this.w);
                this.r = this.w;
                break;
            }
            if (this.buffered() >= this.buf.byteLength) {
                this.r = this.w;
                const oldbuf = this.buf;
                const newbuf = this.buf.slice(0);
                this.buf = newbuf;
                throw new BufferFullError(oldbuf);
            }
            s = this.w - this.r;
            try {
                await this._fill();
            } catch (err) {
                err.partial = slice;
                throw err;
            }
        }
        return slice;
    }
    async peek(n) {
        if (n < 0) {
            throw Error("negative count");
        }
        let avail = this.w - this.r;
        while(avail < n && avail < this.buf.byteLength && !this.eof){
            try {
                await this._fill();
            } catch (err) {
                err.partial = this.buf.subarray(this.r, this.w);
                throw err;
            }
            avail = this.w - this.r;
        }
        if (avail === 0 && this.eof) {
            return null;
        } else if (avail < n && this.eof) {
            return this.buf.subarray(this.r, this.r + avail);
        } else if (avail < n) {
            throw new BufferFullError(this.buf.subarray(this.r, this.w));
        }
        return this.buf.subarray(this.r, this.r + n);
    }
}
class AbstractBufBase {
    buf;
    usedBufferBytes = 0;
    err = null;
    size() {
        return this.buf.byteLength;
    }
    available() {
        return this.buf.byteLength - this.usedBufferBytes;
    }
    buffered() {
        return this.usedBufferBytes;
    }
}
class BufWriter extends AbstractBufBase {
    writer;
    static create(writer, size = 4096) {
        return writer instanceof BufWriter ? writer : new BufWriter(writer, size);
    }
    constructor(writer1, size2 = 4096){
        super();
        this.writer = writer1;
        if (size2 <= 0) {
            size2 = DEFAULT_BUF_SIZE;
        }
        this.buf = new Uint8Array(size2);
    }
    reset(w) {
        this.err = null;
        this.usedBufferBytes = 0;
        this.writer = w;
    }
    async flush() {
        if (this.err !== null) throw this.err;
        if (this.usedBufferBytes === 0) return;
        try {
            await writeAll(this.writer, this.buf.subarray(0, this.usedBufferBytes));
        } catch (e) {
            this.err = e;
            throw e;
        }
        this.buf = new Uint8Array(this.buf.length);
        this.usedBufferBytes = 0;
    }
    async write(data) {
        if (this.err !== null) throw this.err;
        if (data.length === 0) return 0;
        let totalBytesWritten = 0;
        let numBytesWritten = 0;
        while(data.byteLength > this.available()){
            if (this.buffered() === 0) {
                try {
                    numBytesWritten = await this.writer.write(data);
                } catch (e) {
                    this.err = e;
                    throw e;
                }
            } else {
                numBytesWritten = copy(data, this.buf, this.usedBufferBytes);
                this.usedBufferBytes += numBytesWritten;
                await this.flush();
            }
            totalBytesWritten += numBytesWritten;
            data = data.subarray(numBytesWritten);
        }
        numBytesWritten = copy(data, this.buf, this.usedBufferBytes);
        this.usedBufferBytes += numBytesWritten;
        totalBytesWritten += numBytesWritten;
        return totalBytesWritten;
    }
}
function isProhibidedForTrailer(key) {
    const s = new Set([
        "transfer-encoding",
        "content-length",
        "trailer"
    ]);
    return s.has(key.toLowerCase());
}
async function readTrailers(headers, r2) {
    const trailers = parseTrailer(headers.get("trailer"));
    if (trailers == null) return;
    const trailerNames = [
        ...trailers.keys()
    ];
    const tp = new TextProtoReader(r2);
    const result = await tp.readMIMEHeader();
    if (result == null) {
        throw new Deno.errors.InvalidData("Missing trailer header.");
    }
    const undeclared = [
        ...result.keys()
    ].filter((k)=>!trailerNames.includes(k)
    );
    if (undeclared.length > 0) {
        throw new Deno.errors.InvalidData(`Undeclared trailers: ${Deno.inspect(undeclared)}.`);
    }
    for (const [k, v] of result){
        headers.append(k, v);
    }
    const missingTrailers = trailerNames.filter((k1)=>!result.has(k1)
    );
    if (missingTrailers.length > 0) {
        throw new Deno.errors.InvalidData(`Missing trailers: ${Deno.inspect(missingTrailers)}.`);
    }
    headers.delete("trailer");
}
function parseTrailer(field) {
    if (field == null) {
        return undefined;
    }
    const trailerNames = field.split(",").map((v)=>v.trim().toLowerCase()
    );
    if (trailerNames.length === 0) {
        throw new Deno.errors.InvalidData("Empty trailer header.");
    }
    const prohibited = trailerNames.filter((k)=>isProhibidedForTrailer(k)
    );
    if (prohibited.length > 0) {
        throw new Deno.errors.InvalidData(`Prohibited trailer names: ${Deno.inspect(prohibited)}.`);
    }
    return new Headers(trailerNames.map((key)=>[
            key,
            ""
        ]
    ));
}
async function writeChunkedBody(w, r2) {
    for await (const chunk of iter(r2)){
        if (chunk.byteLength <= 0) continue;
        const start = encoder.encode(`${chunk.byteLength.toString(16)}\r\n`);
        const end = encoder.encode("\r\n");
        await w.write(start);
        await w.write(chunk);
        await w.write(end);
        await w.flush();
    }
    const endChunk = encoder.encode("0\r\n\r\n");
    await w.write(endChunk);
}
async function writeTrailers(w, headers, trailers) {
    const trailer = headers.get("trailer");
    if (trailer === null) {
        throw new TypeError("Missing trailer header.");
    }
    const transferEncoding = headers.get("transfer-encoding");
    if (transferEncoding === null || !transferEncoding.match(/^chunked/)) {
        throw new TypeError(`Trailers are only allowed for "transfer-encoding: chunked", got "transfer-encoding: ${transferEncoding}".`);
    }
    const writer1 = BufWriter.create(w);
    const trailerNames = trailer.split(",").map((s)=>s.trim().toLowerCase()
    );
    const prohibitedTrailers = trailerNames.filter((k)=>isProhibidedForTrailer(k)
    );
    if (prohibitedTrailers.length > 0) {
        throw new TypeError(`Prohibited trailer names: ${Deno.inspect(prohibitedTrailers)}.`);
    }
    const undeclared = [
        ...trailers.keys()
    ].filter((k)=>!trailerNames.includes(k)
    );
    if (undeclared.length > 0) {
        throw new TypeError(`Undeclared trailers: ${Deno.inspect(undeclared)}.`);
    }
    for (const [key, value] of trailers){
        await writer1.write(encoder.encode(`${key}: ${value}\r\n`));
    }
    await writer1.write(encoder.encode("\r\n"));
    await writer1.flush();
}
async function writeResponse(w, r2) {
    const protoMajor = 1;
    const protoMinor = 1;
    const statusCode = r2.status || 200;
    const statusText = (r2.statusText ?? STATUS_TEXT.get(statusCode)) ?? null;
    const writer1 = BufWriter.create(w);
    if (statusText === null) {
        throw new Deno.errors.InvalidData("Empty statusText (explicitely pass an empty string if this was intentional)");
    }
    if (!r2.body) {
        r2.body = new Uint8Array();
    }
    if (typeof r2.body === "string") {
        r2.body = encoder.encode(r2.body);
    }
    let out = `HTTP/${1}.${1} ${statusCode} ${statusText}\r\n`;
    const headers = r2.headers ?? new Headers();
    if (r2.body && !headers.get("content-length")) {
        if (r2.body instanceof Uint8Array) {
            out += `content-length: ${r2.body.byteLength}\r\n`;
        } else if (!headers.get("transfer-encoding")) {
            out += "transfer-encoding: chunked\r\n";
        }
    }
    for (const [key, value] of headers){
        out += `${key}: ${value}\r\n`;
    }
    out += `\r\n`;
    const header = encoder.encode(out);
    const n = await writer1.write(header);
    assert(n === header.byteLength);
    if (r2.body instanceof Uint8Array) {
        const n1 = await writer1.write(r2.body);
        assert(n1 === r2.body.byteLength);
    } else if (headers.has("content-length")) {
        const contentLength = headers.get("content-length");
        assert(contentLength != null);
        const bodyLength = parseInt(contentLength);
        const n1 = await Deno.copy(r2.body, writer1);
        assert(n1 === bodyLength);
    } else {
        await writeChunkedBody(writer1, r2.body);
    }
    if (r2.trailers) {
        const t = await r2.trailers();
        await writeTrailers(writer1, headers, t);
    }
    await writer1.flush();
}
class ServerRequest {
    url;
    method;
    proto;
    protoMinor;
    protoMajor;
    headers;
    conn;
    r;
    w;
    #done = deferred();
    #contentLength = undefined;
    #body = undefined;
    #finalized = false;
    get done() {
        return this.#done.then((e)=>e
        );
    }
    get contentLength() {
        if (this.#contentLength === undefined) {
            const cl = this.headers.get("content-length");
            if (cl) {
                this.#contentLength = parseInt(cl);
                if (Number.isNaN(this.#contentLength)) {
                    this.#contentLength = null;
                }
            } else {
                this.#contentLength = null;
            }
        }
        return this.#contentLength;
    }
    get body() {
        if (!this.#body) {
            if (this.contentLength != null) {
                this.#body = bodyReader(this.contentLength, this.r);
            } else {
                const transferEncoding = this.headers.get("transfer-encoding");
                if (transferEncoding != null) {
                    const parts = transferEncoding.split(",").map((e)=>e.trim().toLowerCase()
                    );
                    assert(parts.includes("chunked"), 'transfer-encoding must include "chunked" if content-length is not set');
                    this.#body = chunkedBodyReader(this.headers, this.r);
                } else {
                    this.#body = emptyReader();
                }
            }
        }
        return this.#body;
    }
    async respond(r) {
        let err;
        try {
            await writeResponse(this.w, r);
        } catch (e) {
            try {
                this.conn.close();
            } catch  {
            }
            err = e;
        }
        this.#done.resolve(err);
        if (err) {
            throw err;
        }
    }
    async finalize() {
        if (this.#finalized) return;
        const body = this.body;
        const buf = new Uint8Array(1024);
        while(await body.read(buf) !== null){
        }
        this.#finalized = true;
    }
}
function parseHTTPVersion(vers) {
    switch(vers){
        case "HTTP/1.1":
            return [
                1,
                1
            ];
        case "HTTP/1.0":
            return [
                1,
                0
            ];
        default:
            {
                const Big = 1000000;
                if (!vers.startsWith("HTTP/")) {
                    break;
                }
                const dot = vers.indexOf(".");
                if (dot < 0) {
                    break;
                }
                const majorStr = vers.substring(vers.indexOf("/") + 1, dot);
                const major = Number(majorStr);
                if (!Number.isInteger(major) || major < 0 || major > 1000000) {
                    break;
                }
                const minorStr = vers.substring(dot + 1);
                const minor = Number(minorStr);
                if (!Number.isInteger(minor) || minor < 0 || minor > 1000000) {
                    break;
                }
                return [
                    major,
                    minor
                ];
            }
    }
    throw new Error(`malformed HTTP version ${vers}`);
}
async function readRequest(conn, bufr) {
    const tp = new TextProtoReader(bufr);
    const firstLine = await tp.readLine();
    if (firstLine === null) return null;
    const headers = await tp.readMIMEHeader();
    if (headers === null) throw new Deno.errors.UnexpectedEof();
    const req = new ServerRequest();
    req.conn = conn;
    req.r = bufr;
    [req.method, req.url, req.proto] = firstLine.split(" ", 3);
    [req.protoMajor, req.protoMinor] = parseHTTPVersion(req.proto);
    req.headers = headers;
    fixLength(req);
    return req;
}
class Server {
    listener;
    #closing = false;
    #connections = [];
    constructor(listener){
        this.listener = listener;
    }
    close() {
        this.#closing = true;
        this.listener.close();
        for (const conn of this.#connections){
            try {
                conn.close();
            } catch (e) {
                if (!(e instanceof Deno.errors.BadResource)) {
                    throw e;
                }
            }
        }
    }
    async *iterateHttpRequests(conn) {
        const reader = new BufReader(conn);
        const writer1 = new BufWriter(conn);
        while(!this.#closing){
            let request;
            try {
                request = await readRequest(conn, reader);
            } catch (error) {
                if (error instanceof Deno.errors.InvalidData || error instanceof Deno.errors.UnexpectedEof) {
                    try {
                        await writeResponse(writer1, {
                            status: 400,
                            body: new TextEncoder().encode(`${error.message}\r\n\r\n`)
                        });
                    } catch  {
                    }
                }
                break;
            }
            if (request === null) {
                break;
            }
            request.w = writer1;
            yield request;
            const responseError = await request.done;
            if (responseError) {
                this.untrackConnection(request.conn);
                return;
            }
            try {
                await request.finalize();
            } catch  {
                break;
            }
        }
        this.untrackConnection(conn);
        try {
            conn.close();
        } catch  {
        }
    }
    trackConnection(conn) {
        this.#connections.push(conn);
    }
    untrackConnection(conn) {
        const index = this.#connections.indexOf(conn);
        if (index !== -1) {
            this.#connections.splice(index, 1);
        }
    }
    async *acceptConnAndIterateHttpRequests(mux) {
        if (this.#closing) return;
        let conn;
        try {
            conn = await this.listener.accept();
        } catch (error) {
            if (error instanceof Deno.errors.BadResource || error instanceof Deno.errors.InvalidData || error instanceof Deno.errors.UnexpectedEof || error instanceof Deno.errors.ConnectionReset) {
                return mux.add(this.acceptConnAndIterateHttpRequests(mux));
            }
            throw error;
        }
        this.trackConnection(conn);
        mux.add(this.acceptConnAndIterateHttpRequests(mux));
        yield* this.iterateHttpRequests(conn);
    }
    [Symbol.asyncIterator]() {
        const mux = new MuxAsyncIterator();
        mux.add(this.acceptConnAndIterateHttpRequests(mux));
        return mux.iterate();
    }
}
function _parseAddrFromStr(addr) {
    let url;
    try {
        const host = addr.startsWith(":") ? `0.0.0.0${addr}` : addr;
        url = new URL(`http://${host}`);
    } catch  {
        throw new TypeError("Invalid address.");
    }
    if (url.username || url.password || url.pathname != "/" || url.search || url.hash) {
        throw new TypeError("Invalid address.");
    }
    return {
        hostname: url.hostname,
        port: url.port === "" ? 80 : Number(url.port)
    };
}
function serve(addr) {
    if (typeof addr === "string") {
        addr = _parseAddrFromStr(addr);
    }
    const listener1 = Deno.listen(addr);
    return new Server(listener1);
}
async function listenAndServe(addr, handler) {
    const server = serve(addr);
    for await (const request of server){
        handler(request);
    }
}
function serveTLS(options) {
    const tlsOptions = {
        ...options,
        transport: "tcp"
    };
    const listener1 = Deno.listenTls(tlsOptions);
    return new Server(listener1);
}
async function listenAndServeTLS(options, handler) {
    const server = serveTLS(options);
    for await (const request of server){
        handler(request);
    }
}
function fixLength(req) {
    const contentLength = req.headers.get("Content-Length");
    if (contentLength) {
        const arrClen = contentLength.split(",");
        if (arrClen.length > 1) {
            const distinct = [
                ...new Set(arrClen.map((e)=>e.trim()
                ))
            ];
            if (distinct.length > 1) {
                throw Error("cannot contain multiple Content-Length headers");
            } else {
                req.headers.set("Content-Length", distinct[0]);
            }
        }
        const c = req.headers.get("Content-Length");
        if (req.method === "HEAD" && c && c !== "0") {
            throw Error("http: method cannot contain a Content-Length");
        }
        if (c && req.headers.has("transfer-encoding")) {
            throw new Error("http: Transfer-Encoding and Content-Length cannot be send together");
        }
    }
}
class BufWriterSync extends AbstractBufBase {
    writer;
    static create(writer, size = 4096) {
        return writer instanceof BufWriterSync ? writer : new BufWriterSync(writer, size);
    }
    constructor(writer2, size3 = 4096){
        super();
        this.writer = writer2;
        if (size3 <= 0) {
            size3 = DEFAULT_BUF_SIZE;
        }
        this.buf = new Uint8Array(size3);
    }
    reset(w) {
        this.err = null;
        this.usedBufferBytes = 0;
        this.writer = w;
    }
    flush() {
        if (this.err !== null) throw this.err;
        if (this.usedBufferBytes === 0) return;
        try {
            writeAllSync(this.writer, this.buf.subarray(0, this.usedBufferBytes));
        } catch (e) {
            this.err = e;
            throw e;
        }
        this.buf = new Uint8Array(this.buf.length);
        this.usedBufferBytes = 0;
    }
    writeSync(data) {
        if (this.err !== null) throw this.err;
        if (data.length === 0) return 0;
        let totalBytesWritten = 0;
        let numBytesWritten = 0;
        while(data.byteLength > this.available()){
            if (this.buffered() === 0) {
                try {
                    numBytesWritten = this.writer.writeSync(data);
                } catch (e) {
                    this.err = e;
                    throw e;
                }
            } else {
                numBytesWritten = copy(data, this.buf, this.usedBufferBytes);
                this.usedBufferBytes += numBytesWritten;
                this.flush();
            }
            totalBytesWritten += numBytesWritten;
            data = data.subarray(numBytesWritten);
        }
        numBytesWritten = copy(data, this.buf, this.usedBufferBytes);
        this.usedBufferBytes += numBytesWritten;
        totalBytesWritten += numBytesWritten;
        return totalBytesWritten;
    }
}
const osType = (()=>{
    if (globalThis.Deno != null) {
        return Deno.build.os;
    }
    const navigator = globalThis.navigator;
    if (navigator?.appVersion?.includes?.("Win") ?? false) {
        return "windows";
    }
    return "linux";
})();
const isWindows = osType === "windows";
const CHAR_FORWARD_SLASH = 47;
function assertPath(path) {
    if (typeof path !== "string") {
        throw new TypeError(`Path must be a string. Received ${JSON.stringify(path)}`);
    }
}
function isPosixPathSeparator(code) {
    return code === 47;
}
function isPathSeparator(code) {
    return isPosixPathSeparator(code) || code === 92;
}
function isWindowsDeviceRoot(code) {
    return code >= 97 && code <= 122 || code >= 65 && code <= 90;
}
function normalizeString(path, allowAboveRoot, separator, isPathSeparator1) {
    let res = "";
    let lastSegmentLength = 0;
    let lastSlash = -1;
    let dots = 0;
    let code;
    for(let i = 0, len = path.length; i <= len; ++i){
        if (i < len) code = path.charCodeAt(i);
        else if (isPathSeparator1(code)) break;
        else code = CHAR_FORWARD_SLASH;
        if (isPathSeparator1(code)) {
            if (lastSlash === i - 1 || dots === 1) {
            } else if (lastSlash !== i - 1 && dots === 2) {
                if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 || res.charCodeAt(res.length - 2) !== 46) {
                    if (res.length > 2) {
                        const lastSlashIndex = res.lastIndexOf(separator);
                        if (lastSlashIndex === -1) {
                            res = "";
                            lastSegmentLength = 0;
                        } else {
                            res = res.slice(0, lastSlashIndex);
                            lastSegmentLength = res.length - 1 - res.lastIndexOf(separator);
                        }
                        lastSlash = i;
                        dots = 0;
                        continue;
                    } else if (res.length === 2 || res.length === 1) {
                        res = "";
                        lastSegmentLength = 0;
                        lastSlash = i;
                        dots = 0;
                        continue;
                    }
                }
                if (allowAboveRoot) {
                    if (res.length > 0) res += `${separator}..`;
                    else res = "..";
                    lastSegmentLength = 2;
                }
            } else {
                if (res.length > 0) res += separator + path.slice(lastSlash + 1, i);
                else res = path.slice(lastSlash + 1, i);
                lastSegmentLength = i - lastSlash - 1;
            }
            lastSlash = i;
            dots = 0;
        } else if (code === 46 && dots !== -1) {
            ++dots;
        } else {
            dots = -1;
        }
    }
    return res;
}
function _format(sep, pathObject) {
    const dir = pathObject.dir || pathObject.root;
    const base = pathObject.base || (pathObject.name || "") + (pathObject.ext || "");
    if (!dir) return base;
    if (dir === pathObject.root) return dir + base;
    return dir + sep + base;
}
const WHITESPACE_ENCODINGS = {
    "\u0009": "%09",
    "\u000A": "%0A",
    "\u000B": "%0B",
    "\u000C": "%0C",
    "\u000D": "%0D",
    "\u0020": "%20"
};
function encodeWhitespace(string) {
    return string.replaceAll(/[\s]/g, (c)=>{
        return WHITESPACE_ENCODINGS[c] ?? c;
    });
}
const sep = "\\";
const delimiter = ";";
function resolve(...pathSegments) {
    let resolvedDevice = "";
    let resolvedTail = "";
    let resolvedAbsolute = false;
    for(let i = pathSegments.length - 1; i >= -1; i--){
        let path;
        if (i >= 0) {
            path = pathSegments[i];
        } else if (!resolvedDevice) {
            if (globalThis.Deno == null) {
                throw new TypeError("Resolved a drive-letter-less path without a CWD.");
            }
            path = Deno.cwd();
        } else {
            if (globalThis.Deno == null) {
                throw new TypeError("Resolved a relative path without a CWD.");
            }
            path = Deno.env.get(`=${resolvedDevice}`) || Deno.cwd();
            if (path === undefined || path.slice(0, 3).toLowerCase() !== `${resolvedDevice.toLowerCase()}\\`) {
                path = `${resolvedDevice}\\`;
            }
        }
        assertPath(path);
        const len = path.length;
        if (len === 0) continue;
        let rootEnd = 0;
        let device = "";
        let isAbsolute = false;
        const code = path.charCodeAt(0);
        if (len > 1) {
            if (isPathSeparator(code)) {
                isAbsolute = true;
                if (isPathSeparator(path.charCodeAt(1))) {
                    let j = 2;
                    let last = j;
                    for(; j < len; ++j){
                        if (isPathSeparator(path.charCodeAt(j))) break;
                    }
                    if (j < len && j !== last) {
                        const firstPart = path.slice(last, j);
                        last = j;
                        for(; j < len; ++j){
                            if (!isPathSeparator(path.charCodeAt(j))) break;
                        }
                        if (j < len && j !== last) {
                            last = j;
                            for(; j < len; ++j){
                                if (isPathSeparator(path.charCodeAt(j))) break;
                            }
                            if (j === len) {
                                device = `\\\\${firstPart}\\${path.slice(last)}`;
                                rootEnd = j;
                            } else if (j !== last) {
                                device = `\\\\${firstPart}\\${path.slice(last, j)}`;
                                rootEnd = j;
                            }
                        }
                    }
                } else {
                    rootEnd = 1;
                }
            } else if (isWindowsDeviceRoot(code)) {
                if (path.charCodeAt(1) === 58) {
                    device = path.slice(0, 2);
                    rootEnd = 2;
                    if (len > 2) {
                        if (isPathSeparator(path.charCodeAt(2))) {
                            isAbsolute = true;
                            rootEnd = 3;
                        }
                    }
                }
            }
        } else if (isPathSeparator(code)) {
            rootEnd = 1;
            isAbsolute = true;
        }
        if (device.length > 0 && resolvedDevice.length > 0 && device.toLowerCase() !== resolvedDevice.toLowerCase()) {
            continue;
        }
        if (resolvedDevice.length === 0 && device.length > 0) {
            resolvedDevice = device;
        }
        if (!resolvedAbsolute) {
            resolvedTail = `${path.slice(rootEnd)}\\${resolvedTail}`;
            resolvedAbsolute = isAbsolute;
        }
        if (resolvedAbsolute && resolvedDevice.length > 0) break;
    }
    resolvedTail = normalizeString(resolvedTail, !resolvedAbsolute, "\\", isPathSeparator);
    return resolvedDevice + (resolvedAbsolute ? "\\" : "") + resolvedTail || ".";
}
function normalize(path) {
    assertPath(path);
    const len = path.length;
    if (len === 0) return ".";
    let rootEnd = 0;
    let device;
    let isAbsolute = false;
    const code = path.charCodeAt(0);
    if (len > 1) {
        if (isPathSeparator(code)) {
            isAbsolute = true;
            if (isPathSeparator(path.charCodeAt(1))) {
                let j = 2;
                let last = j;
                for(; j < len; ++j){
                    if (isPathSeparator(path.charCodeAt(j))) break;
                }
                if (j < len && j !== last) {
                    const firstPart = path.slice(last, j);
                    last = j;
                    for(; j < len; ++j){
                        if (!isPathSeparator(path.charCodeAt(j))) break;
                    }
                    if (j < len && j !== last) {
                        last = j;
                        for(; j < len; ++j){
                            if (isPathSeparator(path.charCodeAt(j))) break;
                        }
                        if (j === len) {
                            return `\\\\${firstPart}\\${path.slice(last)}\\`;
                        } else if (j !== last) {
                            device = `\\\\${firstPart}\\${path.slice(last, j)}`;
                            rootEnd = j;
                        }
                    }
                }
            } else {
                rootEnd = 1;
            }
        } else if (isWindowsDeviceRoot(code)) {
            if (path.charCodeAt(1) === 58) {
                device = path.slice(0, 2);
                rootEnd = 2;
                if (len > 2) {
                    if (isPathSeparator(path.charCodeAt(2))) {
                        isAbsolute = true;
                        rootEnd = 3;
                    }
                }
            }
        }
    } else if (isPathSeparator(code)) {
        return "\\";
    }
    let tail;
    if (rootEnd < len) {
        tail = normalizeString(path.slice(rootEnd), !isAbsolute, "\\", isPathSeparator);
    } else {
        tail = "";
    }
    if (tail.length === 0 && !isAbsolute) tail = ".";
    if (tail.length > 0 && isPathSeparator(path.charCodeAt(len - 1))) {
        tail += "\\";
    }
    if (device === undefined) {
        if (isAbsolute) {
            if (tail.length > 0) return `\\${tail}`;
            else return "\\";
        } else if (tail.length > 0) {
            return tail;
        } else {
            return "";
        }
    } else if (isAbsolute) {
        if (tail.length > 0) return `${device}\\${tail}`;
        else return `${device}\\`;
    } else if (tail.length > 0) {
        return device + tail;
    } else {
        return device;
    }
}
function isAbsolute(path) {
    assertPath(path);
    const len = path.length;
    if (len === 0) return false;
    const code = path.charCodeAt(0);
    if (isPathSeparator(code)) {
        return true;
    } else if (isWindowsDeviceRoot(code)) {
        if (len > 2 && path.charCodeAt(1) === 58) {
            if (isPathSeparator(path.charCodeAt(2))) return true;
        }
    }
    return false;
}
function join(...paths) {
    const pathsCount = paths.length;
    if (pathsCount === 0) return ".";
    let joined;
    let firstPart = null;
    for(let i = 0; i < pathsCount; ++i){
        const path = paths[i];
        assertPath(path);
        if (path.length > 0) {
            if (joined === undefined) joined = firstPart = path;
            else joined += `\\${path}`;
        }
    }
    if (joined === undefined) return ".";
    let needsReplace = true;
    let slashCount = 0;
    assert(firstPart != null);
    if (isPathSeparator(firstPart.charCodeAt(0))) {
        ++slashCount;
        const firstLen = firstPart.length;
        if (firstLen > 1) {
            if (isPathSeparator(firstPart.charCodeAt(1))) {
                ++slashCount;
                if (firstLen > 2) {
                    if (isPathSeparator(firstPart.charCodeAt(2))) ++slashCount;
                    else {
                        needsReplace = false;
                    }
                }
            }
        }
    }
    if (needsReplace) {
        for(; slashCount < joined.length; ++slashCount){
            if (!isPathSeparator(joined.charCodeAt(slashCount))) break;
        }
        if (slashCount >= 2) joined = `\\${joined.slice(slashCount)}`;
    }
    return normalize(joined);
}
function relative(from, to) {
    assertPath(from);
    assertPath(to);
    if (from === to) return "";
    const fromOrig = resolve(from);
    const toOrig = resolve(to);
    if (fromOrig === toOrig) return "";
    from = fromOrig.toLowerCase();
    to = toOrig.toLowerCase();
    if (from === to) return "";
    let fromStart = 0;
    let fromEnd = from.length;
    for(; fromStart < fromEnd; ++fromStart){
        if (from.charCodeAt(fromStart) !== 92) break;
    }
    for(; fromEnd - 1 > fromStart; --fromEnd){
        if (from.charCodeAt(fromEnd - 1) !== 92) break;
    }
    const fromLen = fromEnd - fromStart;
    let toStart = 0;
    let toEnd = to.length;
    for(; toStart < toEnd; ++toStart){
        if (to.charCodeAt(toStart) !== 92) break;
    }
    for(; toEnd - 1 > toStart; --toEnd){
        if (to.charCodeAt(toEnd - 1) !== 92) break;
    }
    const toLen = toEnd - toStart;
    const length = fromLen < toLen ? fromLen : toLen;
    let lastCommonSep = -1;
    let i = 0;
    for(; i <= length; ++i){
        if (i === length) {
            if (toLen > length) {
                if (to.charCodeAt(toStart + i) === 92) {
                    return toOrig.slice(toStart + i + 1);
                } else if (i === 2) {
                    return toOrig.slice(toStart + i);
                }
            }
            if (fromLen > length) {
                if (from.charCodeAt(fromStart + i) === 92) {
                    lastCommonSep = i;
                } else if (i === 2) {
                    lastCommonSep = 3;
                }
            }
            break;
        }
        const fromCode = from.charCodeAt(fromStart + i);
        const toCode = to.charCodeAt(toStart + i);
        if (fromCode !== toCode) break;
        else if (fromCode === 92) lastCommonSep = i;
    }
    if (i !== length && lastCommonSep === -1) {
        return toOrig;
    }
    let out = "";
    if (lastCommonSep === -1) lastCommonSep = 0;
    for(i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i){
        if (i === fromEnd || from.charCodeAt(i) === 92) {
            if (out.length === 0) out += "..";
            else out += "\\..";
        }
    }
    if (out.length > 0) {
        return out + toOrig.slice(toStart + lastCommonSep, toEnd);
    } else {
        toStart += lastCommonSep;
        if (toOrig.charCodeAt(toStart) === 92) ++toStart;
        return toOrig.slice(toStart, toEnd);
    }
}
function toNamespacedPath(path) {
    if (typeof path !== "string") return path;
    if (path.length === 0) return "";
    const resolvedPath = resolve(path);
    if (resolvedPath.length >= 3) {
        if (resolvedPath.charCodeAt(0) === 92) {
            if (resolvedPath.charCodeAt(1) === 92) {
                const code = resolvedPath.charCodeAt(2);
                if (code !== 63 && code !== 46) {
                    return `\\\\?\\UNC\\${resolvedPath.slice(2)}`;
                }
            }
        } else if (isWindowsDeviceRoot(resolvedPath.charCodeAt(0))) {
            if (resolvedPath.charCodeAt(1) === 58 && resolvedPath.charCodeAt(2) === 92) {
                return `\\\\?\\${resolvedPath}`;
            }
        }
    }
    return path;
}
function dirname(path) {
    assertPath(path);
    const len = path.length;
    if (len === 0) return ".";
    let rootEnd = -1;
    let end = -1;
    let matchedSlash = true;
    let offset = 0;
    const code = path.charCodeAt(0);
    if (len > 1) {
        if (isPathSeparator(code)) {
            rootEnd = offset = 1;
            if (isPathSeparator(path.charCodeAt(1))) {
                let j = 2;
                let last = j;
                for(; j < len; ++j){
                    if (isPathSeparator(path.charCodeAt(j))) break;
                }
                if (j < len && j !== last) {
                    last = j;
                    for(; j < len; ++j){
                        if (!isPathSeparator(path.charCodeAt(j))) break;
                    }
                    if (j < len && j !== last) {
                        last = j;
                        for(; j < len; ++j){
                            if (isPathSeparator(path.charCodeAt(j))) break;
                        }
                        if (j === len) {
                            return path;
                        }
                        if (j !== last) {
                            rootEnd = offset = j + 1;
                        }
                    }
                }
            }
        } else if (isWindowsDeviceRoot(code)) {
            if (path.charCodeAt(1) === 58) {
                rootEnd = offset = 2;
                if (len > 2) {
                    if (isPathSeparator(path.charCodeAt(2))) rootEnd = offset = 3;
                }
            }
        }
    } else if (isPathSeparator(code)) {
        return path;
    }
    for(let i = len - 1; i >= offset; --i){
        if (isPathSeparator(path.charCodeAt(i))) {
            if (!matchedSlash) {
                end = i;
                break;
            }
        } else {
            matchedSlash = false;
        }
    }
    if (end === -1) {
        if (rootEnd === -1) return ".";
        else end = rootEnd;
    }
    return path.slice(0, end);
}
function basename(path, ext = "") {
    if (ext !== undefined && typeof ext !== "string") {
        throw new TypeError('"ext" argument must be a string');
    }
    assertPath(path);
    let start = 0;
    let end = -1;
    let matchedSlash = true;
    let i;
    if (path.length >= 2) {
        const drive = path.charCodeAt(0);
        if (isWindowsDeviceRoot(drive)) {
            if (path.charCodeAt(1) === 58) start = 2;
        }
    }
    if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
        if (ext.length === path.length && ext === path) return "";
        let extIdx = ext.length - 1;
        let firstNonSlashEnd = -1;
        for(i = path.length - 1; i >= start; --i){
            const code = path.charCodeAt(i);
            if (isPathSeparator(code)) {
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else {
                if (firstNonSlashEnd === -1) {
                    matchedSlash = false;
                    firstNonSlashEnd = i + 1;
                }
                if (extIdx >= 0) {
                    if (code === ext.charCodeAt(extIdx)) {
                        if ((--extIdx) === -1) {
                            end = i;
                        }
                    } else {
                        extIdx = -1;
                        end = firstNonSlashEnd;
                    }
                }
            }
        }
        if (start === end) end = firstNonSlashEnd;
        else if (end === -1) end = path.length;
        return path.slice(start, end);
    } else {
        for(i = path.length - 1; i >= start; --i){
            if (isPathSeparator(path.charCodeAt(i))) {
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else if (end === -1) {
                matchedSlash = false;
                end = i + 1;
            }
        }
        if (end === -1) return "";
        return path.slice(start, end);
    }
}
function extname(path) {
    assertPath(path);
    let start = 0;
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    let preDotState = 0;
    if (path.length >= 2 && path.charCodeAt(1) === 58 && isWindowsDeviceRoot(path.charCodeAt(0))) {
        start = startPart = 2;
    }
    for(let i = path.length - 1; i >= start; --i){
        const code = path.charCodeAt(i);
        if (isPathSeparator(code)) {
            if (!matchedSlash) {
                startPart = i + 1;
                break;
            }
            continue;
        }
        if (end === -1) {
            matchedSlash = false;
            end = i + 1;
        }
        if (code === 46) {
            if (startDot === -1) startDot = i;
            else if (preDotState !== 1) preDotState = 1;
        } else if (startDot !== -1) {
            preDotState = -1;
        }
    }
    if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
        return "";
    }
    return path.slice(startDot, end);
}
function format3(pathObject) {
    if (pathObject === null || typeof pathObject !== "object") {
        throw new TypeError(`The "pathObject" argument must be of type Object. Received type ${typeof pathObject}`);
    }
    return _format("\\", pathObject);
}
function parse(path) {
    assertPath(path);
    const ret = {
        root: "",
        dir: "",
        base: "",
        ext: "",
        name: ""
    };
    const len = path.length;
    if (len === 0) return ret;
    let rootEnd = 0;
    let code = path.charCodeAt(0);
    if (len > 1) {
        if (isPathSeparator(code)) {
            rootEnd = 1;
            if (isPathSeparator(path.charCodeAt(1))) {
                let j = 2;
                let last = j;
                for(; j < len; ++j){
                    if (isPathSeparator(path.charCodeAt(j))) break;
                }
                if (j < len && j !== last) {
                    last = j;
                    for(; j < len; ++j){
                        if (!isPathSeparator(path.charCodeAt(j))) break;
                    }
                    if (j < len && j !== last) {
                        last = j;
                        for(; j < len; ++j){
                            if (isPathSeparator(path.charCodeAt(j))) break;
                        }
                        if (j === len) {
                            rootEnd = j;
                        } else if (j !== last) {
                            rootEnd = j + 1;
                        }
                    }
                }
            }
        } else if (isWindowsDeviceRoot(code)) {
            if (path.charCodeAt(1) === 58) {
                rootEnd = 2;
                if (len > 2) {
                    if (isPathSeparator(path.charCodeAt(2))) {
                        if (len === 3) {
                            ret.root = ret.dir = path;
                            return ret;
                        }
                        rootEnd = 3;
                    }
                } else {
                    ret.root = ret.dir = path;
                    return ret;
                }
            }
        }
    } else if (isPathSeparator(code)) {
        ret.root = ret.dir = path;
        return ret;
    }
    if (rootEnd > 0) ret.root = path.slice(0, rootEnd);
    let startDot = -1;
    let startPart = rootEnd;
    let end = -1;
    let matchedSlash = true;
    let i = path.length - 1;
    let preDotState = 0;
    for(; i >= rootEnd; --i){
        code = path.charCodeAt(i);
        if (isPathSeparator(code)) {
            if (!matchedSlash) {
                startPart = i + 1;
                break;
            }
            continue;
        }
        if (end === -1) {
            matchedSlash = false;
            end = i + 1;
        }
        if (code === 46) {
            if (startDot === -1) startDot = i;
            else if (preDotState !== 1) preDotState = 1;
        } else if (startDot !== -1) {
            preDotState = -1;
        }
    }
    if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
        if (end !== -1) {
            ret.base = ret.name = path.slice(startPart, end);
        }
    } else {
        ret.name = path.slice(startPart, startDot);
        ret.base = path.slice(startPart, end);
        ret.ext = path.slice(startDot, end);
    }
    if (startPart > 0 && startPart !== rootEnd) {
        ret.dir = path.slice(0, startPart - 1);
    } else ret.dir = ret.root;
    return ret;
}
function fromFileUrl(url) {
    url = url instanceof URL ? url : new URL(url);
    if (url.protocol != "file:") {
        throw new TypeError("Must be a file URL.");
    }
    let path = decodeURIComponent(url.pathname.replace(/\//g, "\\").replace(/%(?![0-9A-Fa-f]{2})/g, "%25")).replace(/^\\*([A-Za-z]:)(\\|$)/, "$1\\");
    if (url.hostname != "") {
        path = `\\\\${url.hostname}${path}`;
    }
    return path;
}
function toFileUrl(path) {
    if (!isAbsolute(path)) {
        throw new TypeError("Must be an absolute path.");
    }
    const [, hostname, pathname] = path.match(/^(?:[/\\]{2}([^/\\]+)(?=[/\\](?:[^/\\]|$)))?(.*)/);
    const url = new URL("file:///");
    url.pathname = encodeWhitespace(pathname.replace(/%/g, "%25"));
    if (hostname != null && hostname != "localhost") {
        url.hostname = hostname;
        if (!url.hostname) {
            throw new TypeError("Invalid hostname.");
        }
    }
    return url;
}
const mod = function() {
    return {
        sep: sep,
        delimiter: delimiter,
        resolve: resolve,
        normalize: normalize,
        isAbsolute: isAbsolute,
        join: join,
        relative: relative,
        toNamespacedPath: toNamespacedPath,
        dirname: dirname,
        basename: basename,
        extname: extname,
        format: format3,
        parse: parse,
        fromFileUrl: fromFileUrl,
        toFileUrl: toFileUrl
    };
}();
const sep1 = "/";
const delimiter1 = ":";
function resolve1(...pathSegments) {
    let resolvedPath = "";
    let resolvedAbsolute = false;
    for(let i = pathSegments.length - 1; i >= -1 && !resolvedAbsolute; i--){
        let path;
        if (i >= 0) path = pathSegments[i];
        else {
            if (globalThis.Deno == null) {
                throw new TypeError("Resolved a relative path without a CWD.");
            }
            path = Deno.cwd();
        }
        assertPath(path);
        if (path.length === 0) {
            continue;
        }
        resolvedPath = `${path}/${resolvedPath}`;
        resolvedAbsolute = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
    }
    resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, "/", isPosixPathSeparator);
    if (resolvedAbsolute) {
        if (resolvedPath.length > 0) return `/${resolvedPath}`;
        else return "/";
    } else if (resolvedPath.length > 0) return resolvedPath;
    else return ".";
}
function normalize1(path) {
    assertPath(path);
    if (path.length === 0) return ".";
    const isAbsolute1 = path.charCodeAt(0) === 47;
    const trailingSeparator = path.charCodeAt(path.length - 1) === 47;
    path = normalizeString(path, !isAbsolute1, "/", isPosixPathSeparator);
    if (path.length === 0 && !isAbsolute1) path = ".";
    if (path.length > 0 && trailingSeparator) path += "/";
    if (isAbsolute1) return `/${path}`;
    return path;
}
function isAbsolute1(path) {
    assertPath(path);
    return path.length > 0 && path.charCodeAt(0) === 47;
}
function join1(...paths) {
    if (paths.length === 0) return ".";
    let joined;
    for(let i = 0, len = paths.length; i < len; ++i){
        const path = paths[i];
        assertPath(path);
        if (path.length > 0) {
            if (!joined) joined = path;
            else joined += `/${path}`;
        }
    }
    if (!joined) return ".";
    return normalize1(joined);
}
function relative1(from, to) {
    assertPath(from);
    assertPath(to);
    if (from === to) return "";
    from = resolve1(from);
    to = resolve1(to);
    if (from === to) return "";
    let fromStart = 1;
    const fromEnd = from.length;
    for(; fromStart < fromEnd; ++fromStart){
        if (from.charCodeAt(fromStart) !== 47) break;
    }
    const fromLen = fromEnd - fromStart;
    let toStart = 1;
    const toEnd = to.length;
    for(; toStart < toEnd; ++toStart){
        if (to.charCodeAt(toStart) !== 47) break;
    }
    const toLen = toEnd - toStart;
    const length = fromLen < toLen ? fromLen : toLen;
    let lastCommonSep = -1;
    let i = 0;
    for(; i <= length; ++i){
        if (i === length) {
            if (toLen > length) {
                if (to.charCodeAt(toStart + i) === 47) {
                    return to.slice(toStart + i + 1);
                } else if (i === 0) {
                    return to.slice(toStart + i);
                }
            } else if (fromLen > length) {
                if (from.charCodeAt(fromStart + i) === 47) {
                    lastCommonSep = i;
                } else if (i === 0) {
                    lastCommonSep = 0;
                }
            }
            break;
        }
        const fromCode = from.charCodeAt(fromStart + i);
        const toCode = to.charCodeAt(toStart + i);
        if (fromCode !== toCode) break;
        else if (fromCode === 47) lastCommonSep = i;
    }
    let out = "";
    for(i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i){
        if (i === fromEnd || from.charCodeAt(i) === 47) {
            if (out.length === 0) out += "..";
            else out += "/..";
        }
    }
    if (out.length > 0) return out + to.slice(toStart + lastCommonSep);
    else {
        toStart += lastCommonSep;
        if (to.charCodeAt(toStart) === 47) ++toStart;
        return to.slice(toStart);
    }
}
function toNamespacedPath1(path) {
    return path;
}
function dirname1(path) {
    assertPath(path);
    if (path.length === 0) return ".";
    const hasRoot = path.charCodeAt(0) === 47;
    let end = -1;
    let matchedSlash = true;
    for(let i = path.length - 1; i >= 1; --i){
        if (path.charCodeAt(i) === 47) {
            if (!matchedSlash) {
                end = i;
                break;
            }
        } else {
            matchedSlash = false;
        }
    }
    if (end === -1) return hasRoot ? "/" : ".";
    if (hasRoot && end === 1) return "//";
    return path.slice(0, end);
}
function basename1(path, ext = "") {
    if (ext !== undefined && typeof ext !== "string") {
        throw new TypeError('"ext" argument must be a string');
    }
    assertPath(path);
    let start = 0;
    let end = -1;
    let matchedSlash = true;
    let i;
    if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
        if (ext.length === path.length && ext === path) return "";
        let extIdx = ext.length - 1;
        let firstNonSlashEnd = -1;
        for(i = path.length - 1; i >= 0; --i){
            const code = path.charCodeAt(i);
            if (code === 47) {
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else {
                if (firstNonSlashEnd === -1) {
                    matchedSlash = false;
                    firstNonSlashEnd = i + 1;
                }
                if (extIdx >= 0) {
                    if (code === ext.charCodeAt(extIdx)) {
                        if ((--extIdx) === -1) {
                            end = i;
                        }
                    } else {
                        extIdx = -1;
                        end = firstNonSlashEnd;
                    }
                }
            }
        }
        if (start === end) end = firstNonSlashEnd;
        else if (end === -1) end = path.length;
        return path.slice(start, end);
    } else {
        for(i = path.length - 1; i >= 0; --i){
            if (path.charCodeAt(i) === 47) {
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else if (end === -1) {
                matchedSlash = false;
                end = i + 1;
            }
        }
        if (end === -1) return "";
        return path.slice(start, end);
    }
}
function extname1(path) {
    assertPath(path);
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    let preDotState = 0;
    for(let i = path.length - 1; i >= 0; --i){
        const code = path.charCodeAt(i);
        if (code === 47) {
            if (!matchedSlash) {
                startPart = i + 1;
                break;
            }
            continue;
        }
        if (end === -1) {
            matchedSlash = false;
            end = i + 1;
        }
        if (code === 46) {
            if (startDot === -1) startDot = i;
            else if (preDotState !== 1) preDotState = 1;
        } else if (startDot !== -1) {
            preDotState = -1;
        }
    }
    if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
        return "";
    }
    return path.slice(startDot, end);
}
function format1(pathObject) {
    if (pathObject === null || typeof pathObject !== "object") {
        throw new TypeError(`The "pathObject" argument must be of type Object. Received type ${typeof pathObject}`);
    }
    return _format("/", pathObject);
}
function parse1(path) {
    assertPath(path);
    const ret = {
        root: "",
        dir: "",
        base: "",
        ext: "",
        name: ""
    };
    if (path.length === 0) return ret;
    const isAbsolute2 = path.charCodeAt(0) === 47;
    let start;
    if (isAbsolute2) {
        ret.root = "/";
        start = 1;
    } else {
        start = 0;
    }
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    let i = path.length - 1;
    let preDotState = 0;
    for(; i >= start; --i){
        const code = path.charCodeAt(i);
        if (code === 47) {
            if (!matchedSlash) {
                startPart = i + 1;
                break;
            }
            continue;
        }
        if (end === -1) {
            matchedSlash = false;
            end = i + 1;
        }
        if (code === 46) {
            if (startDot === -1) startDot = i;
            else if (preDotState !== 1) preDotState = 1;
        } else if (startDot !== -1) {
            preDotState = -1;
        }
    }
    if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
        if (end !== -1) {
            if (startPart === 0 && isAbsolute2) {
                ret.base = ret.name = path.slice(1, end);
            } else {
                ret.base = ret.name = path.slice(startPart, end);
            }
        }
    } else {
        if (startPart === 0 && isAbsolute2) {
            ret.name = path.slice(1, startDot);
            ret.base = path.slice(1, end);
        } else {
            ret.name = path.slice(startPart, startDot);
            ret.base = path.slice(startPart, end);
        }
        ret.ext = path.slice(startDot, end);
    }
    if (startPart > 0) ret.dir = path.slice(0, startPart - 1);
    else if (isAbsolute2) ret.dir = "/";
    return ret;
}
function fromFileUrl1(url) {
    url = url instanceof URL ? url : new URL(url);
    if (url.protocol != "file:") {
        throw new TypeError("Must be a file URL.");
    }
    return decodeURIComponent(url.pathname.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"));
}
function toFileUrl1(path) {
    if (!isAbsolute1(path)) {
        throw new TypeError("Must be an absolute path.");
    }
    const url = new URL("file:///");
    url.pathname = encodeWhitespace(path.replace(/%/g, "%25").replace(/\\/g, "%5C"));
    return url;
}
const mod1 = function() {
    return {
        sep: sep1,
        delimiter: delimiter1,
        resolve: resolve1,
        normalize: normalize1,
        isAbsolute: isAbsolute1,
        join: join1,
        relative: relative1,
        toNamespacedPath: toNamespacedPath1,
        dirname: dirname1,
        basename: basename1,
        extname: extname1,
        format: format1,
        parse: parse1,
        fromFileUrl: fromFileUrl1,
        toFileUrl: toFileUrl1
    };
}();
const path = isWindows ? mod : mod1;
const posix = mod1;
const { basename: basename2 , delimiter: delimiter2 , dirname: dirname2 , extname: extname2 , format: format2 , fromFileUrl: fromFileUrl2 , isAbsolute: isAbsolute2 , join: join2 , normalize: normalize2 , parse: parse2 , relative: relative2 , resolve: resolve2 , sep: sep2 , toFileUrl: toFileUrl2 , toNamespacedPath: toNamespacedPath2 ,  } = path;
const config = {
    webServer: {
        port: 8080
    },
    image: {
        repository: join2(Deno.cwd(), '.imagerepo'),
        sizeLimit: 4000,
        defaultSize: 200,
        extensions: [
            'jpg',
            'jpeg',
            'png'
        ]
    },
    cache: {
        path: join2(Deno.cwd(), '.imagecache')
    },
    render: {
        jpgQuality: 85,
        pngCompression: 3
    },
    stats: {
        enabled: true,
        interval: 10000,
        cacheHitSize: 100
    }
};
(()=>{
    const env = Deno.env.toObject();
    console.log({
        env
    });
    if (env.WEBSERVER_PORT) {
        const parsed = parseInt(env.WEBSERVER_PORT);
        if (parsed > 0 && parsed <= 65536) {
            config.webServer.port = parsed;
        }
    }
    if (env.IMAGE_REPOSITORY) {
        config.image.repository = resolve2(env.IMAGE_REPOSITORY);
    }
    if (env.IMAGE_DEFAULTSIZE) {
        const parsed = parseInt(env.IMAGE_DEFAULTSIZE);
        if (parsed > 0) {
            config.image.defaultSize = parsed;
        }
    }
    if (env.IMAGE_EXTENSIONS) {
        const parsed = env.IMAGE_EXTENSIONS.split(',').map((ext)=>ext.trim()
        );
        config.image.extensions = parsed;
    }
    if (env.CACHE_PATH) {
        config.cache.path = resolve2(env.CACHE_PATH);
    }
    if (env.RENDER_JPGQUALITY) {
        const parsed = parseInt(env.RENDER_JPGQUALITY);
        if (parsed >= 0 && parsed <= 100) {
            config.render.jpgQuality = parsed;
        }
    }
    if (env.RENDER_PNGCOMPRESSION) {
        const parsed = parseInt(env.RENDER_JPGQUALITY);
        if (parsed >= 0 && parsed <= 100) {
            config.render.pngCompression = parsed;
        }
    }
    if (env.STATS_ENABLED) {
        config.stats.enabled = !!parseInt(env.STATS_ENABLED);
    }
    if (env.STATS_INTERVAL) {
        const parsed = parseInt(env.STATS_INTERVAL);
        if (parsed >= 0) {
            config.stats.interval = parsed;
        }
    }
    if (env.STATS_CACHEHITSIZE) {
        const parsed = parseInt(env.STATS_CACHEHITSIZE);
        if (parsed >= 0) {
            config.stats.cacheHitSize = parsed;
        }
    }
})();
function get(obj, key) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
        return obj[key];
    }
}
function getForce(obj, key) {
    const v = get(obj, key);
    assert(v != null);
    return v;
}
function isNumber(x) {
    if (typeof x === "number") return true;
    if (/^0x[0-9a-f]+$/i.test(String(x))) return true;
    return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(e[-+]?\d+)?$/.test(String(x));
}
function hasKey(obj, keys) {
    let o = obj;
    keys.slice(0, -1).forEach((key)=>{
        o = get(o, key) ?? {
        };
    });
    const key = keys[keys.length - 1];
    return key in o;
}
function parse3(args, { "--": doubleDash = false , alias ={
} , boolean: __boolean = false , default: defaults = {
} , stopEarly =false , string =[] , unknown =(i)=>i
  } = {
}) {
    const flags = {
        bools: {
        },
        strings: {
        },
        unknownFn: unknown,
        allBools: false
    };
    if (__boolean !== undefined) {
        if (typeof __boolean === "boolean") {
            flags.allBools = !!__boolean;
        } else {
            const booleanArgs = typeof __boolean === "string" ? [
                __boolean
            ] : __boolean;
            for (const key of booleanArgs.filter(Boolean)){
                flags.bools[key] = true;
            }
        }
    }
    const aliases = {
    };
    if (alias !== undefined) {
        for(const key in alias){
            const val = getForce(alias, key);
            if (typeof val === "string") {
                aliases[key] = [
                    val
                ];
            } else {
                aliases[key] = val;
            }
            for (const alias1 of getForce(aliases, key)){
                aliases[alias1] = [
                    key
                ].concat(aliases[key].filter((y)=>alias1 !== y
                ));
            }
        }
    }
    if (string !== undefined) {
        const stringArgs = typeof string === "string" ? [
            string
        ] : string;
        for (const key of stringArgs.filter(Boolean)){
            flags.strings[key] = true;
            const alias1 = get(aliases, key);
            if (alias1) {
                for (const al of alias1){
                    flags.strings[al] = true;
                }
            }
        }
    }
    const argv = {
        _: []
    };
    function argDefined(key, arg) {
        return flags.allBools && /^--[^=]+$/.test(arg) || get(flags.bools, key) || !!get(flags.strings, key) || !!get(aliases, key);
    }
    function setKey(obj, keys, value) {
        let o = obj;
        keys.slice(0, -1).forEach(function(key) {
            if (get(o, key) === undefined) {
                o[key] = {
                };
            }
            o = get(o, key);
        });
        const key = keys[keys.length - 1];
        if (get(o, key) === undefined || get(flags.bools, key) || typeof get(o, key) === "boolean") {
            o[key] = value;
        } else if (Array.isArray(get(o, key))) {
            o[key].push(value);
        } else {
            o[key] = [
                get(o, key),
                value
            ];
        }
    }
    function setArg(key, val, arg = undefined) {
        if (arg && flags.unknownFn && !argDefined(key, arg)) {
            if (flags.unknownFn(arg, key, val) === false) return;
        }
        const value = !get(flags.strings, key) && isNumber(val) ? Number(val) : val;
        setKey(argv, key.split("."), value);
        const alias1 = get(aliases, key);
        if (alias1) {
            for (const x of alias1){
                setKey(argv, x.split("."), value);
            }
        }
    }
    function aliasIsBoolean(key) {
        return getForce(aliases, key).some((x)=>typeof get(flags.bools, x) === "boolean"
        );
    }
    for (const key of Object.keys(flags.bools)){
        setArg(key, defaults[key] === undefined ? false : defaults[key]);
    }
    let notFlags = [];
    if (args.includes("--")) {
        notFlags = args.slice(args.indexOf("--") + 1);
        args = args.slice(0, args.indexOf("--"));
    }
    for(let i = 0; i < args.length; i++){
        const arg = args[i];
        if (/^--.+=/.test(arg)) {
            const m = arg.match(/^--([^=]+)=(.*)$/s);
            assert(m != null);
            const [, key1, value] = m;
            if (flags.bools[key1]) {
                const booleanValue = value !== "false";
                setArg(key1, booleanValue, arg);
            } else {
                setArg(key1, value, arg);
            }
        } else if (/^--no-.+/.test(arg)) {
            const m = arg.match(/^--no-(.+)/);
            assert(m != null);
            setArg(m[1], false, arg);
        } else if (/^--.+/.test(arg)) {
            const m = arg.match(/^--(.+)/);
            assert(m != null);
            const [, key1] = m;
            const next = args[i + 1];
            if (next !== undefined && !/^-/.test(next) && !get(flags.bools, key1) && !flags.allBools && (get(aliases, key1) ? !aliasIsBoolean(key1) : true)) {
                setArg(key1, next, arg);
                i++;
            } else if (/^(true|false)$/.test(next)) {
                setArg(key1, next === "true", arg);
                i++;
            } else {
                setArg(key1, get(flags.strings, key1) ? "" : true, arg);
            }
        } else if (/^-[^-]+/.test(arg)) {
            const letters = arg.slice(1, -1).split("");
            let broken = false;
            for(let j = 0; j < letters.length; j++){
                const next = arg.slice(j + 2);
                if (next === "-") {
                    setArg(letters[j], next, arg);
                    continue;
                }
                if (/[A-Za-z]/.test(letters[j]) && /=/.test(next)) {
                    setArg(letters[j], next.split(/=(.+)/)[1], arg);
                    broken = true;
                    break;
                }
                if (/[A-Za-z]/.test(letters[j]) && /-?\d+(\.\d*)?(e-?\d+)?$/.test(next)) {
                    setArg(letters[j], next, arg);
                    broken = true;
                    break;
                }
                if (letters[j + 1] && letters[j + 1].match(/\W/)) {
                    setArg(letters[j], arg.slice(j + 2), arg);
                    broken = true;
                    break;
                } else {
                    setArg(letters[j], get(flags.strings, letters[j]) ? "" : true, arg);
                }
            }
            const [key1] = arg.slice(-1);
            if (!broken && key1 !== "-") {
                if (args[i + 1] && !/^(-|--)[^-]/.test(args[i + 1]) && !get(flags.bools, key1) && (get(aliases, key1) ? !aliasIsBoolean(key1) : true)) {
                    setArg(key1, args[i + 1], arg);
                    i++;
                } else if (args[i + 1] && /^(true|false)$/.test(args[i + 1])) {
                    setArg(key1, args[i + 1] === "true", arg);
                    i++;
                } else {
                    setArg(key1, get(flags.strings, key1) ? "" : true, arg);
                }
            }
        } else {
            if (!flags.unknownFn || flags.unknownFn(arg) !== false) {
                argv._.push(flags.strings["_"] ?? !isNumber(arg) ? arg : Number(arg));
            }
            if (stopEarly) {
                argv._.push(...args.slice(i + 1));
                break;
            }
        }
    }
    for (const key1 of Object.keys(defaults)){
        if (!hasKey(argv, key1.split("."))) {
            setKey(argv, key1.split("."), defaults[key1]);
            if (aliases[key1]) {
                for (const x of aliases[key1]){
                    setKey(argv, x.split("."), defaults[key1]);
                }
            }
        }
    }
    if (doubleDash) {
        argv["--"] = [];
        for (const key2 of notFlags){
            argv["--"].push(key2);
        }
    } else {
        for (const key2 of notFlags){
            argv._.push(key2);
        }
    }
    return argv;
}
const importMeta = {
    url: "https://deno.land/std@0.100.0/http/file_server.ts",
    main: false
};
const encoder1 = new TextEncoder();
const serverArgs = parse3(Deno.args);
const target = mod1.resolve(serverArgs._[0] ?? "");
const MEDIA_TYPES = {
    ".md": "text/markdown",
    ".html": "text/html",
    ".htm": "text/html",
    ".json": "application/json",
    ".map": "application/json",
    ".txt": "text/plain",
    ".ts": "text/typescript",
    ".tsx": "text/tsx",
    ".js": "application/javascript",
    ".jsx": "text/jsx",
    ".gz": "application/gzip",
    ".css": "text/css",
    ".wasm": "application/wasm",
    ".mjs": "application/javascript",
    ".svg": "image/svg+xml"
};
function contentType(path1) {
    return MEDIA_TYPES[extname2(path1)];
}
function modeToString(isDir, maybeMode) {
    const modeMap = [
        "---",
        "--x",
        "-w-",
        "-wx",
        "r--",
        "r-x",
        "rw-",
        "rwx"
    ];
    if (maybeMode === null) {
        return "(unknown mode)";
    }
    const mode = maybeMode.toString(8);
    if (mode.length < 3) {
        return "(unknown mode)";
    }
    let output = "";
    mode.split("").reverse().slice(0, 3).forEach((v)=>{
        output = modeMap[+v] + output;
    });
    output = `(${isDir ? "d" : "-"}${output})`;
    return output;
}
function fileLenToString(len) {
    const multiplier = 1024;
    let base = 1;
    const suffix = [
        "B",
        "K",
        "M",
        "G",
        "T"
    ];
    let suffixIndex = 0;
    while(base * 1024 < len){
        if (suffixIndex >= suffix.length - 1) {
            break;
        }
        base *= multiplier;
        suffixIndex++;
    }
    return `${(len / base).toFixed(2)}${suffix[suffixIndex]}`;
}
async function serveFile(req, filePath) {
    const [file, fileInfo] = await Promise.all([
        Deno.open(filePath),
        Deno.stat(filePath), 
    ]);
    const headers = new Headers();
    headers.set("content-length", fileInfo.size.toString());
    const contentTypeValue = contentType(filePath);
    if (contentTypeValue) {
        headers.set("content-type", contentTypeValue);
    }
    req.done.then(()=>{
        file.close();
    });
    return {
        status: 200,
        body: file,
        headers
    };
}
async function serveDir(req, dirPath) {
    const showDotfiles = serverArgs.dotfiles ?? true;
    const dirUrl = `/${mod1.relative(target, dirPath)}`;
    const listEntry = [];
    if (dirUrl !== "/") {
        const prevPath = mod1.join(dirPath, "..");
        const fileInfo = await Deno.stat(prevPath);
        listEntry.push({
            mode: modeToString(true, fileInfo.mode),
            size: "",
            name: "../",
            url: mod1.join(dirUrl, "..")
        });
    }
    for await (const entry of Deno.readDir(dirPath)){
        if (!showDotfiles && entry.name[0] === ".") {
            continue;
        }
        const filePath = mod1.join(dirPath, entry.name);
        const fileUrl = mod1.join(dirUrl, entry.name);
        if (entry.name === "index.html" && entry.isFile) {
            return serveFile(req, filePath);
        }
        const fileInfo = await Deno.stat(filePath);
        listEntry.push({
            mode: modeToString(entry.isDirectory, fileInfo.mode),
            size: entry.isFile ? fileLenToString(fileInfo.size ?? 0) : "",
            name: `${entry.name}${entry.isDirectory ? "/" : ""}`,
            url: `${fileUrl}${entry.isDirectory ? "/" : ""}`
        });
    }
    listEntry.sort((a, b)=>a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1
    );
    const formattedDirUrl = `${dirUrl.replace(/\/$/, "")}/`;
    const page = encoder1.encode(dirViewerTemplate(formattedDirUrl, listEntry));
    const headers = new Headers();
    headers.set("content-type", "text/html");
    const res = {
        status: 200,
        body: page,
        headers
    };
    return res;
}
function serveFallback(_req, e) {
    if (e instanceof URIError) {
        return Promise.resolve({
            status: 400,
            body: encoder1.encode("Bad Request")
        });
    } else if (e instanceof Deno.errors.NotFound) {
        return Promise.resolve({
            status: 404,
            body: encoder1.encode("Not Found")
        });
    } else {
        return Promise.resolve({
            status: 500,
            body: encoder1.encode("Internal server error")
        });
    }
}
function serverLog(req, res) {
    const d = new Date().toISOString();
    const dateFmt = `[${d.slice(0, 10)} ${d.slice(11, 19)}]`;
    const s = `${dateFmt} "${req.method} ${req.url} ${req.proto}" ${res.status}`;
    console.log(s);
}
function setCORS(res) {
    if (!res.headers) {
        res.headers = new Headers();
    }
    res.headers.append("access-control-allow-origin", "*");
    res.headers.append("access-control-allow-headers", "Origin, X-Requested-With, Content-Type, Accept, Range");
}
function dirViewerTemplate(dirname3, entries) {
    return html`\n    <!DOCTYPE html>\n    <html lang="en">\n      <head>\n        <meta charset="UTF-8" />\n        <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n        <meta http-equiv="X-UA-Compatible" content="ie=edge" />\n        <title>Deno File Server</title>\n        <style>\n          :root {\n            --background-color: #fafafa;\n            --color: rgba(0, 0, 0, 0.87);\n          }\n          @media (prefers-color-scheme: dark) {\n            :root {\n              --background-color: #303030;\n              --color: #fff;\n            }\n          }\n          @media (min-width: 960px) {\n            main {\n              max-width: 960px;\n            }\n            body {\n              padding-left: 32px;\n              padding-right: 32px;\n            }\n          }\n          @media (min-width: 600px) {\n            main {\n              padding-left: 24px;\n              padding-right: 24px;\n            }\n          }\n          body {\n            background: var(--background-color);\n            color: var(--color);\n            font-family: "Roboto", "Helvetica", "Arial", sans-serif;\n            font-weight: 400;\n            line-height: 1.43;\n            font-size: 0.875rem;\n          }\n          a {\n            color: #2196f3;\n            text-decoration: none;\n          }\n          a:hover {\n            text-decoration: underline;\n          }\n          table th {\n            text-align: left;\n          }\n          table td {\n            padding: 12px 24px 0 0;\n          }\n        </style>\n      </head>\n      <body>\n        <main>\n          <h1>Index of ${dirname3}</h1>\n          <table>\n            <tr>\n              <th>Mode</th>\n              <th>Size</th>\n              <th>Name</th>\n            </tr>\n            ${entries.map((entry)=>html`\n                  <tr>\n                    <td class="mode">\n                      ${entry.mode}\n                    </td>\n                    <td>\n                      ${entry.size}\n                    </td>\n                    <td>\n                      <a href="${entry.url}">${entry.name}</a>\n                    </td>\n                  </tr>\n                `
    )}\n          </table>\n        </main>\n      </body>\n    </html>\n  `;
}
function html(strings, ...values) {
    const l = strings.length - 1;
    let html1 = "";
    for(let i = 0; i < l; i++){
        let v = values[i];
        if (v instanceof Array) {
            v = v.join("");
        }
        const s = strings[i] + v;
        html1 += s;
    }
    html1 += strings[l];
    return html1;
}
function normalizeURL(url) {
    let normalizedUrl = url;
    try {
        normalizedUrl = decodeURI(normalizedUrl);
    } catch (e) {
        if (!(e instanceof URIError)) {
            throw e;
        }
    }
    try {
        const absoluteURI = new URL(normalizedUrl);
        normalizedUrl = absoluteURI.pathname;
    } catch (e) {
        if (!(e instanceof TypeError)) {
            throw e;
        }
    }
    if (normalizedUrl[0] !== "/") {
        throw new URIError("The request URI is malformed.");
    }
    normalizedUrl = posix.normalize(normalizedUrl);
    const startOfParams = normalizedUrl.indexOf("?");
    return startOfParams > -1 ? normalizedUrl.slice(0, startOfParams) : normalizedUrl;
}
function main() {
    const CORSEnabled = serverArgs.cors ? true : false;
    const port = (serverArgs.port ?? serverArgs.p) ?? 4507;
    const host = serverArgs.host ?? "0.0.0.0";
    const addr = `${host}:${port}`;
    const tlsOpts = {
    };
    tlsOpts.certFile = (serverArgs.cert ?? serverArgs.c) ?? "";
    tlsOpts.keyFile = (serverArgs.key ?? serverArgs.k) ?? "";
    const dirListingEnabled = serverArgs["dir-listing"] ?? true;
    if (tlsOpts.keyFile || tlsOpts.certFile) {
        if (tlsOpts.keyFile === "" || tlsOpts.certFile === "") {
            console.log("--key and --cert are required for TLS");
            serverArgs.h = true;
        }
    }
    if (serverArgs.h ?? serverArgs.help) {
        console.log(`Deno File Server\n    Serves a local directory in HTTP.\n\n  INSTALL:\n    deno install --allow-net --allow-read https://deno.land/std/http/file_server.ts\n\n  USAGE:\n    file_server [path] [options]\n\n  OPTIONS:\n    -h, --help          Prints help information\n    -p, --port <PORT>   Set port\n    --cors              Enable CORS via the "Access-Control-Allow-Origin" header\n    --host     <HOST>   Hostname (default is 0.0.0.0)\n    -c, --cert <FILE>   TLS certificate file (enables TLS)\n    -k, --key  <FILE>   TLS key file (enables TLS)\n    --no-dir-listing    Disable directory listing\n    --no-dotfiles       Do not show dotfiles\n\n    All TLS options are required when one is provided.`);
        Deno.exit();
    }
    const handler = async (req)=>{
        let response;
        try {
            const normalizedUrl = normalizeURL(req.url);
            let fsPath = mod1.join(target, normalizedUrl);
            if (fsPath.indexOf(target) !== 0) {
                fsPath = target;
            }
            const fileInfo = await Deno.stat(fsPath);
            if (fileInfo.isDirectory) {
                if (dirListingEnabled) {
                    response = await serveDir(req, fsPath);
                } else {
                    throw new Deno.errors.NotFound();
                }
            } else {
                response = await serveFile(req, fsPath);
            }
        } catch (e) {
            console.error(e.message);
            response = await serveFallback(req, e);
        } finally{
            if (CORSEnabled) {
                assert(response);
                setCORS(response);
            }
            serverLog(req, response);
            try {
                await req.respond(response);
            } catch (e) {
                console.error(e.message);
            }
        }
    };
    let proto = "http";
    if (tlsOpts.keyFile || tlsOpts.certFile) {
        proto += "s";
        tlsOpts.hostname = host;
        tlsOpts.port = port;
        listenAndServeTLS(tlsOpts, handler);
    } else {
        listenAndServe(addr, handler);
    }
    console.log(`${proto.toUpperCase()} server listening on ${proto}://${addr}/`);
}
if (importMeta.main) {
    main();
}
async function exists(filePath) {
    try {
        await Deno.lstat(filePath);
        return true;
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            return false;
        }
        throw err;
    }
}
async function _createWalkEntry(path1) {
    path1 = normalize2(path1);
    const name = basename2(path1);
    const info = await Deno.stat(path1);
    return {
        path: path1,
        name,
        isFile: info.isFile,
        isDirectory: info.isDirectory,
        isSymlink: info.isSymlink
    };
}
function include(path1, exts, match, skip) {
    if (exts && !exts.some((ext)=>path1.endsWith(ext)
    )) {
        return false;
    }
    if (match && !match.some((pattern)=>!!path1.match(pattern)
    )) {
        return false;
    }
    if (skip && skip.some((pattern)=>!!path1.match(pattern)
    )) {
        return false;
    }
    return true;
}
function wrapErrorWithRootPath(err, root) {
    if (err.root) return err;
    err.root = root;
    err.message = `${err.message} for path "${root}"`;
    return err;
}
async function* walk(root, { maxDepth =Infinity , includeFiles =true , includeDirs =true , followSymlinks =false , exts =undefined , match =undefined , skip =undefined  } = {
}) {
    if (maxDepth < 0) {
        return;
    }
    if (includeDirs && include(root, exts, match, skip)) {
        yield await _createWalkEntry(root);
    }
    if (maxDepth < 1 || !include(root, undefined, undefined, skip)) {
        return;
    }
    try {
        for await (const entry of Deno.readDir(root)){
            assert(entry.name != null);
            let path1 = join2(root, entry.name);
            if (entry.isSymlink) {
                if (followSymlinks) {
                    path1 = await Deno.realPath(path1);
                } else {
                    continue;
                }
            }
            if (entry.isFile) {
                if (includeFiles && include(path1, exts, match, skip)) {
                    yield {
                        path: path1,
                        ...entry
                    };
                }
            } else {
                yield* walk(path1, {
                    maxDepth: maxDepth - 1,
                    includeFiles,
                    includeDirs,
                    followSymlinks,
                    exts,
                    match,
                    skip
                });
            }
        }
    } catch (err) {
        throw wrapErrorWithRootPath(err, normalize2(root));
    }
}
var EOL;
(function(EOL1) {
    EOL1["LF"] = "\n";
    EOL1["CRLF"] = "\r\n";
})(EOL || (EOL = {
}));
const base64abc = [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "I",
    "J",
    "K",
    "L",
    "M",
    "N",
    "O",
    "P",
    "Q",
    "R",
    "S",
    "T",
    "U",
    "V",
    "W",
    "X",
    "Y",
    "Z",
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "i",
    "j",
    "k",
    "l",
    "m",
    "n",
    "o",
    "p",
    "q",
    "r",
    "s",
    "t",
    "u",
    "v",
    "w",
    "x",
    "y",
    "z",
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "+",
    "/"
];
function encode(data) {
    const uint8 = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    let result = "", i;
    const l = uint8.length;
    for(i = 2; i < l; i += 3){
        result += base64abc[uint8[i - 2] >> 2];
        result += base64abc[(uint8[i - 2] & 3) << 4 | uint8[i - 1] >> 4];
        result += base64abc[(uint8[i - 1] & 15) << 2 | uint8[i] >> 6];
        result += base64abc[uint8[i] & 63];
    }
    if (i === l + 1) {
        result += base64abc[uint8[i - 2] >> 2];
        result += base64abc[(uint8[i - 2] & 3) << 4];
        result += "==";
    }
    if (i === l) {
        result += base64abc[uint8[i - 2] >> 2];
        result += base64abc[(uint8[i - 2] & 3) << 4 | uint8[i - 1] >> 4];
        result += base64abc[(uint8[i - 1] & 15) << 2];
        result += "=";
    }
    return result;
}
function decode(b64) {
    const binString = atob(b64);
    const size4 = binString.length;
    const bytes = new Uint8Array(size4);
    for(let i = 0; i < size4; i++){
        bytes[i] = binString.charCodeAt(i);
    }
    return bytes;
}
const importMeta1 = {
    url: "https://deno.land/std@0.100.0/hash/_wasm/wasm.js",
    main: false
};
const source1 = decode("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HiADIAJBmAFqQcgBEIsBIgRBADYCyAEgBEHMAWogAkEIakHIABCLARpB/IXAACEEQQAMEQsgAEHYgcAARwRAIAAoAABB89CFiwNHDRALIAJBkgRqQgA3AQAgAkGaBGpBADsBACACQZwEakIANwIAIAJBpARqQgA3AgAgAkGsBGpCADcCACACQbQEakIANwIAIAJBvARqQgA3AgAgAkHEBGpBADoAACACQcUEakEANgAAIAJByQRqQQA7AAAgAkHLBGpBADoAACACQcAANgKIBCACQQA7AYwEIAJBADYBjgQgAkGYAWogAkGIBGpBxAAQiwEaIAJBqANqIgQgAkHUAWopAgA3AwAgAkGgA2oiBSACQcwBaikCADcDACACQZgDaiIJIAJBxAFqKQIANwMAIAJBkANqIgogAkG8AWopAgA3AwAgAkGIA2oiBiACQbQBaikCADcDACACQYADaiIHIAJBrAFqKQIANwMAIAJB+AJqIgggAkGkAWopAgA3AwAgAiACKQKcATcD8AJB4ABBCBChASIDRQ0XIANCADcDACADQQA2AhwgAyACKQPwAjcDICADQfiXwAApAwA3AwggA0EQakGAmMAAKQMANwMAIANBGGpBiJjAACgCADYCACADQShqIAgpAwA3AwAgA0EwaiAHKQMANwMAIANBOGogBikDADcDACADQUBrIAopAwA3AwAgA0HIAGogCSkDADcDACADQdAAaiAFKQMANwMAIANB2ABqIAQpAwA3AwBB3IHAACEEQQAMEAsgAEGAgsAARg0FIABBgILAAEEGEIMBRQ0FIABBrILAAEYNBiAAQayCwABBBhCDAUUNBiAAQdiCwABGDQcgAEHYgsAAQQYQgwFFDQcgAEGEg8AARwRAIABBhIPAAEEGEIMBDQ8LIAJBADYCiAQgAkGIBGpBBHIhBEEAIQMDQCADIARqQQA6AAAgAiACKAKIBEEBajYCiAQgA0EBaiIDQYABRw0ACyACQZgBaiACQYgEakGEARCLARogAkHwAmogAkGYAWpBBHJBgAEQiwEaQdgBQQgQoQEiA0UNGCADQgA3AwggA0IANwMAIANBADYCUCADQZCZwAApAwA3AxAgA0EYakGYmcAAKQMANwMAIANBIGpBoJnAACkDADcDACADQShqQaiZwAApAwA3AwAgA0EwakGwmcAAKQMANwMAIANBOGpBuJnAACkDADcDACADQUBrQcCZwAApAwA3AwAgA0HIAGpByJnAACkDADcDACADQdQAaiACQfACakGAARCLARpBjIPAACEEQQAMDwsgAEGwg8AARg0HIAApAABC89CFm9PFjJk0UQ0HIABB3IPAAEYNCCAAKQAAQvPQhZvTxcyaNlENCCAAQYiEwABGDQkgACkAAELz0IWb0+WMnDRRDQkgAEG0hMAARwRAIAApAABC89CFm9OlzZgyUg0OCyACQZgBakEAQcgBEJEBGiACQf4CakIANwEAIAJBhgNqQgA3AQAgAkGOA2pCADcBACACQZYDakIANwEAIAJBngNqQgA3AQAgAkGmA2pCADcBACACQa4DakIANwEAIAJBtgNqQQA2AQAgAkG6A2pBADsBACACQQA7AfQCIAJCADcB9gIgAkHIADYC8AIgAkGIBGogAkHwAmpBzAAQiwEaIAJBCGogAkGIBGpBBHJByAAQiwEaQZgCQQgQoQEiA0UNGyADIAJBmAFqQcgBEIsBIgRBADYCyAEgBEHMAWogAkEIakHIABCLARpBvITAACEEQQAMDgsgAkGSBGpCADcBACACQZoEakEAOwEAIAJBEDYCiAQgAkEAOwGMBCACQQA2AY4EIAJBqAFqIgMgAkGYBGoiBCgCADYCACACQaABaiIJIAJBkARqIgUpAwA3AwAgAkHoAmoiBiACQaQBaikCADcDACACIAIpA4gENwOYASACIAIpApwBNwPgAiACQcABaiIHQgA3AwAgAkG4AWoiCEIANwMAIAJBsAFqIg1CADcDACADQgA3AwAgCUIANwMAIAJCADcDmAEgAkH6AmpCADcBACACQYIDakEAOwEAIAJBEDYC8AIgAkEAOwH0AiACQQA2AfYCIAQgAkGAA2ooAgA2AgAgBSACQfgCaiIKKQMANwMAIAJBEGoiCyACQZQEaikCADcDACACIAIpA/ACNwOIBCACIAIpAowENwMIIAJB0AFqIgwgCykDADcDACACIAIpAwg3A8gBIAogBikDADcDACACIAIpA+ACNwPwAiACQcAEaiIGIAwpAwA3AwAgAkG4BGoiCyACKQPIATcDACACQbAEaiIMIAcpAwA3AwAgAkGoBGoiByAIKQMANwMAIAJBoARqIgggDSkDADcDACAEIAMpAwA3AwAgBSAJKQMANwMAIAIgAikDmAE3A4gEQdQAQQQQoQEiA0UNDiADQQA2AgAgAyACKQPwAjcCBCADIAIpA4gENwIUIANBDGogCikDADcCACADQRxqIAUpAwA3AgAgA0EkaiAEKQMANwIAIANBLGogCCkDADcCACADQTRqIAcpAwA3AgAgA0E8aiAMKQMANwIAIANBxABqIAspAwA3AgAgA0HMAGogBikDADcCAEGEgMAAIQRBAAwNCyACQZIEakIANwEAIAJBmgRqQQA7AQAgAkGcBGpCADcCACACQaQEakIANwIAIAJBrARqQgA3AgAgAkG0BGpCADcCACACQbwEakIANwIAIAJBxARqQQA6AAAgAkHFBGpBADYAACACQckEakEAOwAAIAJBywRqQQA6AAAgAkHAADYCiAQgAkEAOwGMBCACQQA2AY4EIAJBmAFqIAJBiARqQcQAEIsBGiACQagDaiIEIAJB1AFqKQIANwMAIAJBoANqIgUgAkHMAWopAgA3AwAgAkGYA2oiCSACQcQBaikCADcDACACQZADaiIKIAJBvAFqKQIANwMAIAJBiANqIgYgAkG0AWopAgA3AwAgAkGAA2oiByACQawBaikCADcDACACQfgCaiIIIAJBpAFqKQIANwMAIAIgAikCnAE3A/ACQeAAQQgQoQEiA0UNEyADQQA2AgggA0IANwMAIAMgAikD8AI3AgwgA0EUaiAIKQMANwIAIANBHGogBykDADcCACADQSRqIAYpAwA3AgAgA0EsaiAKKQMANwIAIANBNGogCSkDADcCACADQTxqIAUpAwA3AgAgA0HEAGogBCkDADcCACADQdQAakHIl8AAKQIANwIAIANBwJfAACkCADcCTEGsgMAAIQRBAAwMCyACQZIEakIANwEAIAJBmgRqQQA7AQAgAkGcBGpCADcCACACQaQEakIANwIAIAJBrARqQgA3AgAgAkG0BGpCADcCACACQbwEakIANwIAIAJBxARqQQA6AAAgAkHFBGpBADYAACACQckEakEAOwAAIAJBywRqQQA6AAAgAkHAADYCiAQgAkEAOwGMBCACQQA2AY4EIAJBmAFqIAJBiARqQcQAEIsBGiACQagDaiIEIAJB1AFqKQIANwMAIAJBoANqIgUgAkHMAWopAgA3AwAgAkGYA2oiCSACQcQBaikCADcDACACQZADaiIKIAJBvAFqKQIANwMAIAJBiANqIgYgAkG0AWopAgA3AwAgAkGAA2oiByACQawBaikCADcDACACQfgCaiIIIAJBpAFqKQIANwMAIAIgAikCnAE3A/ACQeAAQQgQoQEiA0UNEiADQgA3AwAgA0EANgIcIAMgAikD8AI3AyAgA0H4l8AAKQMANwMIIANBEGpBgJjAACkDADcDACADQRhqQYiYwAAoAgA2AgAgA0EoaiAIKQMANwMAIANBMGogBykDADcDACADQThqIAYpAwA3AwAgA0FAayAKKQMANwMAIANByABqIAkpAwA3AwAgA0HQAGogBSkDADcDACADQdgAaiAEKQMANwMAQYSBwAAhBEEADAsLIAJBkgRqQgA3AQAgAkGaBGpBADsBACACQZwEakIANwIAIAJBpARqQgA3AgAgAkGsBGpCADcCACACQbQEakIANwIAIAJBvARqQgA3AgAgAkHEBGpBADoAACACQcUEakEANgAAIAJByQRqQQA7AAAgAkHLBGpBADoAACACQcAANgKIBCACQQA7AYwEIAJBADYBjgQgAkGYAWogAkGIBGpBxAAQiwEaIAJBqANqIgQgAkHUAWopAgA3AwAgAkGgA2oiBSACQcwBaikCADcDACACQZgDaiIJIAJBxAFqKQIANwMAIAJBkANqIgogAkG8AWopAgA3AwAgAkGIA2oiBiACQbQBaikCADcDACACQYADaiIHIAJBrAFqKQIANwMAIAJB+AJqIgggAkGkAWopAgA3AwAgAiACKQKcATcD8AJB+ABBCBChASIDRQ0MIANCADcDACADQQA2AjAgAyACKQPwAjcCNCADQdCXwAApAwA3AwggA0EQakHYl8AAKQMANwMAIANBGGpB4JfAACkDADcDACADQSBqQeiXwAApAwA3AwAgA0EoakHwl8AAKQMANwMAIANBPGogCCkDADcCACADQcQAaiAHKQMANwIAIANBzABqIAYpAwA3AgAgA0HUAGogCikDADcCACADQdwAaiAJKQMANwIAIANB5ABqIAUpAwA3AgAgA0HsAGogBCkDADcCAEG0gcAAIQRBAAwKCyACQZIEakIANwEAIAJBmgRqQQA7AQAgAkGcBGpCADcCACACQaQEakIANwIAIAJBrARqQgA3AgAgAkG0BGpCADcCACACQbwEakIANwIAIAJBxARqQQA6AAAgAkHFBGpBADYAACACQckEakEAOwAAIAJBywRqQQA6AAAgAkHAADYCiAQgAkEAOwGMBCACQQA2AY4EIAJBmAFqIAJBiARqQcQAEIsBGiACQagDaiIEIAJB1AFqKQIANwMAIAJBoANqIgUgAkHMAWopAgA3AwAgAkGYA2oiCSACQcQBaikCADcDACACQZADaiIKIAJBvAFqKQIANwMAIAJBiANqIgYgAkG0AWopAgA3AwAgAkGAA2oiByACQawBaikCADcDACACQfgCaiIIIAJBpAFqKQIANwMAIAIgAikCnAE3A/ACQfAAQQgQoQEiA0UNESADQQA2AgggA0IANwMAIAMgAikD8AI3AgwgA0EUaiAIKQMANwIAIANBHGogBykDADcCACADQSRqIAYpAwA3AgAgA0EsaiAKKQMANwIAIANBNGogCSkDADcCACADQTxqIAUpAwA3AgAgA0HEAGogBCkDADcCACADQeQAakGkmMAAKQIANwIAIANB3ABqQZyYwAApAgA3AgAgA0HUAGpBlJjAACkCADcCACADQYyYwAApAgA3AkxBiILAACEEQQAMCQsgAkGSBGpCADcBACACQZoEakEAOwEAIAJBnARqQgA3AgAgAkGkBGpCADcCACACQawEakIANwIAIAJBtARqQgA3AgAgAkG8BGpCADcCACACQcQEakEAOgAAIAJBxQRqQQA2AAAgAkHJBGpBADsAACACQcsEakEAOgAAIAJBwAA2AogEIAJBADsBjAQgAkEANgGOBCACQZgBaiACQYgEakHEABCLARogAkGoA2oiBCACQdQBaikCADcDACACQaADaiIFIAJBzAFqKQIANwMAIAJBmANqIgkgAkHEAWopAgA3AwAgAkGQA2oiCiACQbwBaikCADcDACACQYgDaiIGIAJBtAFqKQIANwMAIAJBgANqIgcgAkGsAWopAgA3AwAgAkH4AmoiCCACQaQBaikCADcDACACIAIpApwBNwPwAkHwAEEIEKEBIgNFDRAgA0EANgIIIANCADcDACADIAIpA/ACNwIMIANBFGogCCkDADcCACADQRxqIAcpAwA3AgAgA0EkaiAGKQMANwIAIANBLGogCikDADcCACADQTRqIAkpAwA3AgAgA0E8aiAFKQMANwIAIANBxABqIAQpAwA3AgAgA0HkAGpBxJjAACkCADcCACADQdwAakG8mMAAKQIANwIAIANB1ABqQbSYwAApAgA3AgAgA0GsmMAAKQIANwJMQbSCwAAhBEEADAgLIAJBADYCiAQgAkGIBGpBBHIhBEEAIQMDQCADIARqQQA6AAAgAiACKAKIBEEBajYCiAQgA0EBaiIDQYABRw0ACyACQZgBaiACQYgEakGEARCLARogAkHwAmogAkGYAWpBBHJBgAEQiwEaQdgBQQgQoQEiA0UNECADQgA3AwggA0IANwMAIANBADYCUCADQdCYwAApAwA3AxAgA0EYakHYmMAAKQMANwMAIANBIGpB4JjAACkDADcDACADQShqQeiYwAApAwA3AwAgA0EwakHwmMAAKQMANwMAIANBOGpB+JjAACkDADcDACADQUBrQYCZwAApAwA3AwAgA0HIAGpBiJnAACkDADcDACADQdQAaiACQfACakGAARCLARpB4ILAACEEQQAMBwsgAkGYAWpBAEHIARCRARogAkEANgLwAkEEIQMDQCACQfACaiADakEAOgAAIAIgAigC8AJBAWo2AvACIANBAWoiA0GUAUcNAAsgAkGIBGogAkHwAmpBlAEQiwEaIAJBCGogAkGIBGpBBHJBkAEQiwEaQeACQQgQoQEiA0UNECADIAJBmAFqQcgBEIsBIgRBADYCyAEgBEHMAWogAkEIakGQARCLARpBuIPAACEEQQAMBgsgAkGYAWpBAEHIARCRARogAkEANgLwAkEEIQMDQCACQfACaiADakEAOgAAIAIgAigC8AJBAWo2AvACIANBAWoiA0GMAUcNAAsgAkGIBGogAkHwAmpBjAEQiwEaIAJBCGogAkGIBGpBBHJBiAEQiwEaQdgCQQgQoQEiA0UNECADIAJBmAFqQcgBEIsBIgRBADYCyAEgBEHMAWogAkEIakGIARCLARpB5IPAACEEQQAMBQsgAkGYAWpBAEHIARCRARogAkEANgLwAkEEIQMDQCACQfACaiADakEAOgAAIAIgAigC8AJBAWo2AvACIANBAWoiA0HsAEcNAAsgAkGIBGogAkHwAmpB7AAQiwEaIAJBCGogAkGIBGpBBHJB6AAQiwEaQbgCQQgQoQEiA0UNECADIAJBmAFqQcgBEIsBIgRBADYCyAEgBEHMAWogAkEIakHoABCLARpBkITAACEEQQAMBAsgAkGYAWpBAEHIARCRARogAkEA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aiIBIAIgBHNzakHglu21f2pBEHcgAWoiAyABcyACIApqIAEgBHMgA3NqQfD4/vV7akEXdyADaiICc2pBxv3txAJqQQR3IAJqIgRqIAMgC2ogASATaiACIANzIARzakH6z4TVfmpBC3cgBGoiASACIARzc2pBheG8p31qQRB3IAFqIgMgAXMgAiAGaiABIARzIANzakGFuqAkakEXdyADaiICc2pBuaDTzn1qQQR3IAJqIgRqIAIgDGogASAJaiACIANzIARzakHls+62fmpBC3cgBGoiASAEcyADIBJqIAIgBHMgAXNqQfj5if0BakEQdyABaiICc2pB5ayxpXxqQRd3IAJqIgMgAUF/c3IgAnNqQcTEpKF/akEGdyADaiIEaiADIBVqIAIgCGogASAOaiAEIAJBf3NyIANzakGX/6uZBGpBCncgBGoiASADQX9zciAEc2pBp8fQ3HpqQQ93IAFqIgIgBEF/c3IgAXNqQbnAzmRqQRV3IAJqIgMgAUF/c3IgAnNqQcOz7aoGakEGdyADaiIEaiADIBRqIAIgCmogASALaiAEIAJBf3NyIANzakGSmbP4eGpBCncgBGoiASADQX9zciAEc2pB/ei/f2pBD3cgAWoiAiAEQX9zciABc2pB0buRrHhqQRV3IAJqIgMgAUF/c3IgAnNqQc/8of0GakEGdyADaiIEaiADIBFqIAIgBmogASASaiAEIAJBf3NyIANzakHgzbNxakEKdyAEaiIBIANBf3NyIARzakGUhoWYempBD3cgAWoiAiAEQX9zciABc2pBoaOg8ARqQRV3IAJqIgMgAUF/c3IgAnNqQYL9zbp/akEGdyADaiIEIAAoAgBqNgIAIAAgASAQaiAEIAJBf3NyIANzakG15Ovpe2pBCncgBGoiASAAKAIMajYCDCAAIAIgDGogASADQX9zciAEc2pBu6Xf1gJqQQ93IAFqIgIgACgCCGo2AgggACACIAAoAgRqIAMgD2ogAiAEQX9zciABc2pBkaeb3H5qQRV3ajYCBAvcDwEFfyAAIAEtAAAiAzoAECAAIAEtAAEiAjoAESAAIAEtAAIiBDoAEiAAIAEtAAMiBToAEyAAIAEtAAQiBjoAFCAAIAMgAC0AAHM6ACAgACACIAAtAAFzOgAhIAAgBCAALQACczoAIiAAIAUgAC0AA3M6ACMgACAGIAAt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BCARIAEgA0F/c3EgAyAEcXIgAmpqQQd3IgVBf3NxIAMgBXFyIAFqakELdyIBIAVyIBIgBCABIAVxIgQgAyABQX9zcXJqakETdyICcSAEcmogFGpBmfOJ1AVqQQN3IgMgByABIAUgAyABIAJycSABIAJxcmogDWpBmfOJ1AVqQQV3IgQgAiADcnEgAiADcXJqakGZ84nUBWpBCXciASAEciAJIAIgASADIARycSADIARxcmpqQZnzidQFakENdyICcSABIARxcmogDGpBmfOJ1AVqQQN3IgMgDyABIAQgAyABIAJycSABIAJxcmogFWpBmfOJ1AVqQQV3IgQgAiADcnEgAiADcXJqakGZ84nUBWpBCXciASAEciARIAIgASADIARycSADIARxcmpqQZnzidQFakENdyICcSABIARxcmogC2pBmfOJ1AVqQQN3IgMgCiABIAYgBCADIAEgAnJxIAEgAnFyampBmfOJ1AVqQQV3IgQgAiADcnEgAiADcXJqakGZ84nUBWpBCXciASAEciAIIAIgASADIARycSADIARxcmpqQZnzidQFakENdyICcSABIARxcmogE2pBmfOJ1AVqQQN3IgMgEiACIBAgASAOIAQgAyABIAJycSABIAJxcmpqQZnzidQFakEFdyIEIAIgA3JxIAIgA3FyampBmfOJ1AVqQQl3IgUgAyAEcnEgAyAEcXJqakGZ84nUBWpBDXciAyAFcyICIARzaiAUakGh1+f2BmpBA3ciASAJIAMgASAHIAQgASACc2pqQaHX5/YGakEJdyICcyAFIA1qIAEgA3MgAnNqQaHX5/YGakELdyIEc2pqQaHX5/YGakEPdyIDIARzIgUgAnNqIAtqQaHX5/YGakEDdyIBIAggAyABIAogAiABIAVzampBodfn9gZqQQl3IgJzIAQgBmogASADcyACc2pBodfn9gZqQQt3IgRzampBodfn9gZqQQ93IgMgBHMiBSACc2ogDGpBodfn9gZqQQN3IgEgESADIAEgDyACIAEgBXNqakGh1+f2BmpBCXciAnMgBCAVaiABIANzIAJzakGh1+f2BmpBC3ciBHNqakGh1+f2BmpBD3ciAyAEcyIFIAJzaiATakGh1+f2BmpBA3ciASAAKAIAajYCACAAIBAgAiABIAVzampBodfn9gZqQQl3IgIgACgCDGo2Agwg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IgVFDQULIAIgBDYCFCACIAU2AhALIAIoAhAhBSACQThqIgZCADcDACACQTBqIgdCADcDACACQShqIghCADcDACACQSBqIglCADcDACACQRhqIgpCADcDACACQgA3AxAgAkHqAGpCADcBACACQfIAakEAOwEAIAJBEDYCYCACQQA7AWQgAkEANgFmIAJBiAFqIAJB8ABqKAIANgIAIAJBgAFqIAJB6ABqKQMANwMAIAJB2ABqIgsgAkGEAWopAgA3AwAgAiACKQNgNwN4IAIgAikCfDcDUCACQcgAaiIMIAspAwA3AwAgAiACKQNQNwNAIANBOGogDCkDADcAACADQTBqIAIpA0A3AAAgA0EoaiAGKQMANwAAIANBIGogBykDADcAACADQRhqIAgpAwA3AAAgA0EQaiAJKQMANwAAIANBCGogCikDADcAACADIAIpAxA3AAAgAUEANgIAIAAgBDYCBCAAIAU2AgAgAkGQAWokAA8LQbCawABBFyACQRBqQaCXwABBsJfAABB5AAtBEEEBQbSlwAAoAgAiAEECIAAbEQAAAAtBh4zAAEEkQayMwAAQiAEACyAEQQFBtKXAACgCACIAQQIgABsRAAAAC9gIAQV/IABBeGoiASAAQXxqKAIAIgNBeHEiAGohAgJAAkACQAJAIANBAXENACADQQNxRQ0BIAEoAgAiAyAAaiEAIAEgA2siAUH8pMAAKAIARgRAIAIoAgRBA3FBA0cNAUH0pMAAIAA2AgAgAiACKAIEQX5xNgIEIAEgAEEBcjYCBCAAIAFqIAA2AgAPCyABIAMQTAsCQCACQQRqIgQoAgAiA0ECcQRAIAQgA0F+cTYCACABIABBAXI2AgQgACABaiAANgIADAELAkAgAkGApcAAKAIARwRAQfykwAAoAgAgAkYNASACIANBeHEiAhBMIAEgACACaiIAQQFyNgIEIAAgAWogADYCACABQfykwAAoAgBHDQJB9KTAACAANgIADwtBgKXAACABNgIAQfikwABB+KTAACgCACAAaiIANgIAIAEgAEEBcjYCBEH8pMAAKAIAIAFGBEBB9KTAAEEANgIAQfykwABBADYCAAtBnKXAACgCACICIABPDQJBgKXAACgCACIARQ0CAkBB+KTAACgCACIDQSlJDQBBjKXAACEBA0AgASgCACIEIABNBEAgBCABKAIE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KQMwNwNoIAJBIGogAkGMAWopAgA3AwAgAkEYaiACQYQBaikCADcDACACQRBqIAJB/ABqKQIANwMAIAJBCGogAkH0AGopAgA3AwAgAkEoaiACQZQBaikCADcDACACIAIpAmw3AwAgASACEB8gAUIANwMIIAFCADcDACABQQA2AlAgAUHQmMAAKQMANwMQIAFBGGpB2JjAACkDADcDACABQSBqQeCYwAApAwA3AwAgAUEoakHomMAAKQMANwMAIAFBMGpB8JjAACkDADcDACABQThqQfiYwAApAwA3AwAgAUFAa0GAmcAAKQMANwMAIAFByABqQYiZwAApAwA3AwACQAJAQTBBARChASIDBEAgAkIwNwJsIAIgAzYCaCACQegAaiACQTAQXgJAIAIoAmwiBCACKAJwIgNGBEAgBCEDDAELIAQgA0kNAiAERQ0AIAIoAmghBQJAIANFBEAgBRAQQQEhBAwBCyAFIARBASADEJoBIgRFDQQLIAIgAzYCbCACIAQ2AmgLIAIoAmghBCABQgA3AwggAUIANwMAIAFBADYCUCABQRBqIgFB0JjAACkDADcDACABQQhqQdiYwAApAwA3AwAgAUEQakHgmMAAKQMANwMAIAFBGGpB6JjAACkDADcDACABQSBqQfCYwAApAwA3AwAgAUEoakH4mMAAKQMANwMAIAFBMGpBgJnAACkDADcDACABQThqQYiZwAApAwA3AwAgACADNgIEIAAgBDYCACACQaABaiQADwtBMEEBQbSlwAAoAgAiAEECIAAbEQAAAAtBh4zAAEEkQayMwAAQiAEACyADQQFBtKXAACgCACIAQQIgABsRAAAAC78GAQR/IAAgAWohAgJAAkACQAJAAkAgAEEEaigCACIDQQFxDQAgA0EDcUUNASAAKAIAIgMgAWohASAAIANrIgBB/KTAACgCAEYEQCACKAIEQQNxQQNHDQFB9KTAACABNgIAIAIgAigCBEF+cTYCBCAAIAFBAXI2AgQgAiABNgIADwsgACADEEwLAkAgAkEEaigCACIDQQJxBEAgAkEEaiADQX5xNgIAIAAgAUEBcjYCBCAAIAFqIAE2AgAMAQsCQCACQYClwAAoAgBHBEBB/KTAACgCACACRg0BIAIgA0F4cSICEEwgACABIAJqIgFBAXI2AgQgACABaiABNgIAIABB/KTAACgCAEcNAkH0pMAAIAE2AgAPC0GApcAAIAA2AgBB+KTAAEH4pMAAKAIAIAFqIgE2AgAgACABQQFyNgIEIABB/KTAACgCAEcNAkH0pMAAQQA2AgBB/KTAAEEANgIADwtB/KTAACAANgIAQfSkwABB9KTAACgCACABaiIBNgIAIAAgAUEBcjYCBCAAIAFqIAE2AgAPCyABQYACSQ0DIABCADcCECAAQRxqAn9BACABQQh2IgNFDQAaQR8gAUH///8HSw0AGiABQQYgA2ciAmtBH3F2QQFxIAJBAXRrQT5qCyICNgIAIAJBAnRB9KPAAGohAwJAAkBB6KHAACgCACIEQQEgAkEfcXQiBXEEQCADKAIAIgNBBGooAgBBeHEgAUcNASADIQIMAgtB6KHAACAEIAVyNgIAIAMgADYCAAwECyABQQBBGSACQQF2a0EfcSACQR9GG3QhBANAIAMgBEEddkEEcWpBEGoiBSgCACICRQ0DIARBAXQhBCACIQMgAkEEaigCAEF4cSABRw0ACwsgAigCCCIBIAA2AgwgAiAANgIIIABBGGpBADYCACAAIAI2AgwgACABNgIICw8LIAUgADYCAAsgAEEYaiADNgIAIAAgADYCDCAAIAA2AggPCyABQQN2IgJBA3RB7KHAAGohAQJ/QeShwAAoAgAiA0EBIAJ0IgJxBEAgASgCCAwBC0HkocAAIAIgA3I2AgAgAQshAiABIAA2AgggAiAANgIMIAAgATYCDCAAIAI2AggL1AYBBH8jAEHQAWsiAiQAIAJBygBqQgA3AQAgAkHSAGpBADsBACACQdQAakIANwIAIAJB3ABqQgA3AgAgAkHkAGpCADcCACACQewAakIANwIAIAJB9ABqQgA3AgAgAkH8AGpBADoAACACQf0AakEANgAAIAJBgQFqQQA7AAAgAkGDAWpBADoAACACQQA7AUQgAkEANgFGIAJBwAA2AkAgAkGIAWogAkFAa0HEABCLARogAkE4aiACQcQBaikCADcDACACQTBqIAJBvAFqKQIANwMAIAJBKGogAkG0AWopAgA3AwAgAkEgaiACQawBaikCADcDACACQRhqIAJBpAFqKQIANwMAIAJBEGogAkGcAWopAgA3AwAgAkEIaiACQZQBaikCADcDACACIAIpAowBNwMAIAEgAhARIAFCADcDCCABQgA3AwAgAUEANgJQIAFBkJnAACkDADcDECABQRhqQZiZwAApAwA3AwAgAUEgakGgmcAAKQMANwMAIAFBKGpBqJnAACkDADcDACABQTBqQbCZwAApAwA3AwAgAUE4akG4mcAAKQMANwMAIAFBQGtBwJnAACkDADcDACABQcgAakHImcAAKQMANwMAAkACQEHAAEEBEKEBIgMEQCACQsAANwKMASACIAM2AogBIAJBiAFqIAJBwAAQXgJAIAIoAowBIgQgAigCkAEiA0YEQCAEIQMMAQsgBCADSQ0CIARFDQAgAigCiAEhBQJAIANFBEAgBRAQQQEhBAwBCyAFIARBASADEJoBIgRFDQQLIAIgAzYCjAEgAiAENgKIAQsgAigCiAEhBCABQgA3AwggAUIANwMAIAFBADYCUCABQRBqIgFBkJnAACkDADcDACABQQhqQZiZwAApAwA3AwAgAUEQakGgmcAAKQMANwMAIAFBGGpBqJnAACkDADcDACABQSBqQbCZwAApAwA3AwAgAUEoakG4mcAAKQMANwMAIAFBMGpBwJnAACkDADcDACABQThqQciZwAApAwA3AwAgACADNgIEIAAgBDYCACACQdABaiQADwtBwABBAUG0pcAAKAIAIgBBAiAAGxEAAAALQYeMwABBJEGsjMAAEIgBAAsgA0EBQbSlwAAoAgAiAEECIAAbEQAAAAuOBgEKfyMAQTBrIgIkACACQSRqQYCHwAA2AgAgAkEDOgAoIAJCgICAgIAENwMIIAIgADYCICACQQA2AhggAkEANgIQAn8CQAJAAkAgASgCCCIDBEAgASgCACEFIAEoAgQiCCABQQxqKAIAIgYgBiAISxsiBkUNASABQRRqKAIAIQcgASgCECEJIAAgBSgCACAFKAIEQYyHwAAoAgARAwANAyAFQQhqIQECQAJAA0AgAiADQQRqKAIANgIMIAIgA0Ecai0AADoAKCACIANBCGooAgA2AgggA0EYaigCACEAQQAhBAJAAkACQCADQRRqKAIAQQFrDgIAAgELIAAgB08NAyAAQQN0IAlqIgooAgRBA0cNASAKKAIAKAIAIQALQQEhBAsgAiAANgIUIAIgBDYCECADQRBqKAIAIQBBACEEAkACQAJAIANBDGooAgBBAWsOAgACAQsgACAHTw0EIABBA3QgCWoiCigCBEEDRw0BIAooAgAoAgAh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IQEgACgCGCEAA0AgBkF/aiIGRQRAQQAPCyAAIAcgASgCEBEBAEUNAAsLIAULtwUBBH8jAEGQAWsiAiQAIAJBOmpCADcBACACQcIAakEAOwEAIAJBxABqQgA3AgAgAkHMAGpCADcCACACQdQAakIANwIAIAJBADsBNCACQQA2ATYgAkEoNgIwIAJBgAFqIAJB0ABqKQMANwMAIAJB+ABqIAJByABqKQMANwMAIAJB8ABqIAJBQGspAwA3AwAgAkHoAGogAkE4aikDADcDACACQYgBaiACQdgAaigCADYCACACIAIpAzA3A2AgAkEgaiACQfwAaikCADcDACACQRhqIAJB9ABqKQIANwMAIAJBEGogAkHsAGopAgA3AwAgAkEoaiACQYQBaikCADcDACACIAIpAmQ3AwggASACQQhqEE0gAUIANwMAIAFBADYCMCABQdCXwAApAwA3AwggAUEQakHYl8AAKQMANwMAIAFBGGpB4JfAACkDADcDACABQSBqQeiXwAApAwA3AwAgAUEoakHwl8AAKQMANwMAAkACQEEoQQEQoQEiAwRAIAJCKDcCZCACIAM2AmAgAkHgAGogAkEIakEoEF4CQCACKAJkIgQgAigCaCIDRgRAIAQhAwwBCyAEIANJDQIgBEUNACACKAJgIQUCQCADRQRAIAUQEEEBIQQMAQsgBSAEQQEgAxCaASIERQ0ECyACIAM2AmQgAiAENgJgCyACKAJgIQQgAUIANwMAIAFBADYCMCABQQhqIgFB0JfAACkDADcDACABQQhqQdiXwAApAwA3AwAgAUEQakHgl8AAKQMANwMAIAFBGGpB6JfAACkDADcDACABQSBqQfCXwAApAwA3AwAgACADNgIEIAAgBDYCACACQZABaiQADwtBKEEBQbSlwAAoAgAiAEECIAAbEQAAAAtBh4zAAEEkQayMwAAQiAEACyADQQFBtKXAACgCACIAQQIgABsRAAAAC8YEAQR/IwBBoAFrIgIkACACQTpqQgA3AQAgAkHCAGpBADsBACACQcQAakIANwIAIAJBzABqQgA3AgAgAkHUAGpCADcCACACQdwAakIANwIAIAJBADsBNCACQQA2ATYgAkEwNgIwIAJBkAFqIAJB2ABqKQMANwMAIAJBiAFqIAJB0ABqKQMANwMAIAJBgAFqIAJByABqKQMANwMAIAJB+ABqIAJBQGspAwA3AwAgAkHwAGogAkE4aikDADcDACACQZgBaiACQeAAaigCADYCACACIAIpAzA3A2ggAkEgaiACQYwBaikCADcDACACQRhqIAJBhAFqKQIANwMAIAJBEGogAkH8AGopAgA3AwAgAkEIaiACQfQAaikCADcDACACQShqIAJBlAFqKQIANwMAIAIgAikCbDcDACABIAIQYyABQQBByAEQkQEiBUEANgLIAQJAAkBBMEEBEKEBIgEEQCACQjA3AmwgAiABNgJoIAJB6ABqIAJBMBBeAkAgAigCbCIDIAIoAnAiAUYEQCADIQEMAQsgAyABSQ0CIANFDQAgAigCaCEEAkAgAUUEQCAEEBBBASEDDAELIAQgA0EBIAEQmgEiA0UNBAsgAiABNgJsIAIgAzYCaAsgAigCaCEDIAVBAEHIARCRAUEANgLIASAAIAE2AgQgACADNgIAIAJBoAFqJAAPC0EwQQFBtKXAACgCACIAQQIgABsRAAAAC0GHjMAAQSRBrIzAABCIAQALIAFBAUG0pcAAKAIAIgBBAiAAGxEAAAALxgQBBH8jAEGgAWsiAiQAIAJBOmpCADcBACACQcIAakEAOwEAIAJBxABqQgA3AgAgAkHMAGpCADcCACACQdQAakIANwIAIAJB3ABqQgA3AgAgAkEAOwE0IAJBADYBNiACQTA2AjAgAkGQAWogAkHYAGopAwA3AwAgAkGIAWogAkHQAGopAwA3AwAgAkGAAWogAkHIAGopAwA3AwAgAkH4AGogAkFAaykDADcDACACQfAAaiACQThqKQMANwMAIAJBmAFqIAJB4ABqKAIANgIAIAIgAikDMDcDaCACQSBqIAJBjAFqKQIANwMAIAJBGGogAkGEAWopAgA3AwAgAkEQaiACQfwAaikCADcDACACQQhqIAJB9ABqKQIANwMAIAJBKGogAkGUAWopAgA3AwAgAiACKQJsNwMAIAEgAhBkIAFBAEHIARCRASIFQQA2AsgBAkACQEEwQQEQoQEiAQRAIAJCMDcCbCACIAE2AmggAkHoAGogAkEwEF4CQCACKAJsIgMgAigCcCIBRgRAIAMhAQwBCyADIAFJDQIgA0UNACACKAJoIQQCQCABRQRAIAQQEEEBIQMMAQsgBCADQQEgARCaASIDRQ0ECyACIAE2AmwgAiADNgJoCyACKAJoIQMgBUEAQcgBEJEBQQA2AsgBIAAgATYCBCAAIAM2AgAgAkGgAWokAA8LQTBBAUG0pcAAKAIAIgBBAiAAGxEAAAALQYeMwABBJEGsjMAAEIgBAAsgAUEBQbSlwAAoAgAiAEECIAAbEQAAAAu8BAEEfyMAQaADayICJAAgAkHyAmpCADcBACACQfoCakEAOwEAIAJB/AJqQgA3AgAgAkGEA2pCADcCACACQYwDakIANwIAIAJBlANqQgA3AgAgAkEAOwHsAiACQQA2Ae4CIAJBMDYC6AIgAkHYAGogAkGQA2opAwA3AwAgAkHQAGogAkGIA2opAwA3AwAgAkHIAGogAkGAA2opAwA3AwAgAkFAayACQfgCaikDADcDACACQThqIAJB8AJqKQMANwMAIAJB4ABqIAJBmANqKAIANgIAIAIgAikD6AI3AzAgAkEgaiACQdQAaikCADcDACACQRhqIAJBzABqKQIANwMAIAJBEGogAkHEAGopAgA3AwAgAkEIaiACQTxqKQIANwMAIAJBKGogAkHcAGopAgA3AwAgAiACKQI0NwMAIAJBMGogAUG4AhCLARogAkEwaiACEGMCQAJAQTBBARChASIDBEAgAkIwNwI0IAIgAzYCMCACQTBqIAJBMBBeAkAgAigCNCIEIAIoAjgiA0YEQCAEIQMMAQsgBCADSQ0CIARFDQAgAigCMCEFAkAgA0UEQCAFEBBBASEEDAELIAUgBEEBIAMQmgEiBEUNBAsgAiADNgI0IAIgBDYCMAsgAigCMCEEIAEQECAAIAM2AgQgACAENgIAIAJBoANqJAAPC0EwQQFBtKXAACgCACIAQQIgABsRAAAAC0GHjMAAQSRBrIzAABCIAQALIANBAUG0pcAAKAIAIgBBAiAAGxEAAAALvAQBBH8jAEGgA2siAiQAIAJB8gJqQgA3AQAgAkH6AmpBADsBACACQfwCakIANwIAIAJBhANqQgA3AgAgAkGMA2pCADcCACACQZQDakIANwIAIAJBADsB7AIgAkEANgHuAiACQTA2AugCIAJB2ABqIAJBkANqKQMANwMAIAJB0ABqIAJBiANqKQMANwMAIAJByABqIAJBgANqKQMANwMAIAJBQGsgAkH4AmopAwA3AwAgAkE4aiACQfACaikDADcDACACQeAAaiACQZgDaigCADYCACACIAIpA+gCNwMwIAJBIGogAkHUAGopAgA3AwAgAkEYaiACQcwAaikCADcDACACQRBqIAJBxABqKQIANwMAIAJBCGogAkE8aikCADcDACACQShqIAJB3ABqKQIANwMAIAIgAikCNDcDACACQTBqIAFBuAIQiwEaIAJBMGogAhBkAkACQEEwQQEQoQEiAwRAIAJCMDcCNCACIAM2AjAgAkEwaiACQTAQXgJAIAIoAjQiBCACKAI4IgNGBEAgBCEDDAELIAQgA0kNAiAERQ0AIAIoAjAhBQJAIANFBEAgBRAQQQEhBAwBCyAFIARBASADEJoBIgRFDQQLIAIgAzYCNCACIAQ2AjALIAIoAjAhBCABEBAgACADNgIEIAAgBDYCACACQaADaiQADwtBMEEBQbSlwAAoAgAiAEECIAAbEQAAAAtBh4zAAEEkQayMwAAQiAEACyADQQFBtKXAACgCACIAQQIgABsRAAAAC7wEAQR/IwBBwAJrIgIkACACQZICakIANwEAIAJBmgJqQQA7AQAgAkGcAmpCADcCACACQaQCakIANwIAIAJBrAJqQgA3AgAgAkG0AmpCADcCACACQQA7AYwCIAJBADYBjgIgAkEwNgKIAiACQdgAaiACQbACaikDADcDACACQdAAaiACQagCaikDADcDACACQcgAaiACQaACaikDADcDACACQUBrIAJBmAJqKQMANwMAIAJBOGogAkGQAmopAwA3AwAgAkHgAGogAkG4AmooAgA2AgAgAiACKQOIAjcDMCACQSBqIAJB1ABqKQIANwMAIAJBGGogAkHMAGopAgA3AwAgAkEQaiACQcQAaikCADcDACACQQhqIAJBPGopAgA3AwAgAkEoaiACQdwAaikCADcDACACIAIpAjQ3AwAgAkEwaiABQdgBEIsBGiACQTBqIAIQHwJAAkBBMEEBEKEBIgMEQCACQjA3AjQgAiADNgIwIAJBMGogAkEwEF4CQCACKAI0IgQgAigCOCIDRgRAIAQhAwwBCyAEIANJDQIgBEUNACACKAIwIQUCQCADRQRAIAUQEEEBIQQMAQsgBSAEQQEgAxCaASIERQ0ECyACIAM2AjQgAiAENgIwCyACKAIwIQQgARAQIAAgAzYCBCAAIAQ2AgAgAkHAAmokAA8LQTBBAUG0pcAAKAIAIgBBAiAAGxEAAAALQYeMwABBJEGs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AkHwAGokAA8LQSBBAUG0pcAAKAIAIgBBAiAAGxEAAAALQYeMwABBJEGsjMAAEIgBAAsgA0EBQbSlwAAoAgAiAEECIAAbEQAAAAvMBAEEfyMAQdABayICJAAgAkHKAGpCADcBACACQdIAakEAOwEAIAJB1ABqQgA3AgAgAkHcAGpCADcCACACQeQAakIANwIAIAJB7ABqQgA3AgAgAkH0AGpCADcCACACQfwAakEAOgAAIAJB/QBqQQA2AAAgAkGBAWpBADsAACACQYMBakEAOgAAIAJBADsBRCACQQA2AUYgAkHAADYCQCACQYgBaiACQUBrQcQAEIsBGiACQThqIAJBxAFqKQIANwMAIAJBMGogAkG8AWopAgA3AwAgAkEoaiACQbQBaikCADcDACACQSBqIAJBrAFqKQIANwMAIAJBGGogAkGkAWopAgA3AwAgAkEQaiACQZwBaikCADcDACACQQhqIAJBlAFqKQIANwMAIAIgAikCjAE3AwAgASACEFsgAUEAQcgBEJEBIgVBADYCyAECQAJAQcAAQQEQoQEiAQRAIAJCwAA3AowBIAIgATYCiAEgAkGIAWogAkHAABBeAkAgAigCjAEiAyACKAKQASIBRgRAIAMhAQwBCyADIAFJDQIgA0UNACACKAKIASEEAkAgAUUEQCAEEBBBASEDDAELIAQgA0EBIAEQmgEiA0UNBAsgAiABNgKMASACIAM2AogBCyACKAKIASEDIAVBAEHIARCRAUEANgLIASAAIAE2AgQgACADNgIAIAJB0AFqJAAPC0HAAEEBQbSlwAAoAgAiAEECIAAbEQAAAAtBh4zAAEEkQayMwAAQiAEACyABQQFBtKXAACgCACIAQQIgABsRAAAAC8wEAQR/IwBB0AFrIgIkACACQcoAakIANwEAIAJB0gBqQQA7AQAgAkHUAGpCADcCACACQdwAakIANwIAIAJB5ABqQgA3AgAgAkHsAGpCADcCACACQfQAakIANwIAIAJB/ABqQQA6AAAgAkH9AGpBADYAACACQYEBakEAOwAAIAJBgwFqQQA6AAAgAkEAOwFEIAJBADYBRiACQcAANgJAIAJBiAFqIAJBQGtBxAAQiwEaIAJBOGogAkHEAWopAgA3AwAgAkEwaiACQbwBaikCADcDACACQShqIAJBtAFqKQIANwMAIAJBIGogAkGsAWopAgA3AwAgAkEYaiACQaQBaikCADcDACACQRBqIAJBnAFqKQIANwMAIAJBCGogAkGUAWopAgA3AwAgAiACKQKMATcDACABIAIQXCABQQBByAEQkQEiBUEANgLIAQJAAkBBwABBARChASIBBEAgAkLAADcCjAEgAiABNgKIASACQYgBaiACQcAAEF4CQCACKAKMASIDIAIoApABIgFGBEAgAyEBDAELIAMgAUkNAiADRQ0AIAIoAogBIQQCQCABRQRAIAQQEEEBIQMMAQsgBCADQQEgARCaASIDRQ0ECyACIAE2AowBIAIgAzYCiAELIAIoAogBIQMgBUEAQcgBEJEBQQA2AsgBIAAgATYCBCAAIAM2AgAgAkHQAWokAA8LQcAAQQFBtKXAACgCACIAQQIgABsRAAAAC0GHjMAAQSRBrIzAABCIAQALIAFBAUG0pcAAKAIAIgBBAiAAGxEAAAALuAQBBH8jAEGgA2siAiQAIAJB4gJqQgA3AQAgAkHqAmpBADsBACACQewCakIANwIAIAJB9AJqQgA3AgAgAkH8AmpCADcCACACQYQDakIANwIAIAJBjANqQgA3AgAgAkGUA2pBADoAACACQZUDakEANgAAIAJBmQNqQQA7AAAgAkGbA2pBADoAACACQQA7AdwCIAJBADYB3gIgAkHAADYC2AIgAkFAayACQdgCakHEABCLARogAkE4aiACQfwAaikCADcDACACQTBqIAJB9ABqKQIANwMAIAJBKGogAkHsAGopAgA3AwAgAkEgaiACQeQAaikCADcDACACQRhqIAJB3ABqKQIANwMAIAJBEGogAkHUAGopAgA3AwAgAkEIaiACQcwAaikCADcDACACIAIpAkQ3AwAgAkFAayABQZgCEIsBGiACQUBrIAIQWwJAAkBBwABBARChASIDBEAgAkLAADcCRCACIAM2AkAgAkFAayACQcAAEF4CQCACKAJEIgQgAigCSCIDRgRAIAQhAwwBCyAEIANJDQIgBEUNACACKAJAIQUCQCADRQRAIAUQEEEBIQQMAQsgBSAEQQEgAxCaASIERQ0ECyACIAM2AkQgAiAENgJACyACKAJAIQQgARAQIAAgAzYCBCAAIAQ2AgAgAkGgA2okAA8LQcAAQQFBtKXAACgCACIAQQIgABsRAAAAC0GHjMAAQSRBrIzAABCIAQALIANBAUG0pcAAKAIAIgBBAiAAGxEAAAALuAQBBH8jAEGgA2siAiQAIAJB4gJqQgA3AQAgAkHqAmpBADsBACACQewCakIANwIAIAJB9AJqQgA3AgAgAkH8AmpCADcCACACQYQDakIANwIAIAJBjANqQgA3AgAgAkGUA2pBADoAACACQZUDakEANgAAIAJBmQNqQQA7AAAgAkGbA2pBADoAACACQQA7AdwCIAJBADYB3gIgAkHAADYC2AIgAkFAayACQdgCakHEABCLARogAkE4aiACQfwAaikCADcDACACQTBqIAJB9ABqKQIANwMAIAJBKGogAkHsAGopAgA3AwAgAkEgaiACQeQAaikCADcDACACQRhqIAJB3ABqKQIANwMAIAJBEGogAkHUAGopAgA3AwAgAkEIaiACQcwAaikCADcDACACIAIpAkQ3AwAgAkFAayABQZgCEIsBGiACQUBrIAIQXAJAAkBBwABBARChASIDBEAgAkLAADcCRCACIAM2AkAgAkFAayACQcAAEF4CQCACKAJEIgQgAigCSCIDRgRAIAQhAwwBCyAEIANJDQIgBEUNACACKAJAIQUCQCADRQRAIAUQEEEBIQQMAQsgBSAEQQEgAxCaASIERQ0ECyACIAM2AkQgAiAENgJACyACKAJAIQQgARAQIAAgAzYCBCAAIAQ2AgAgAkGgA2okAA8LQcAAQQFBtKXAACgCACIAQQIgABsRAAAAC0GHjMAAQSRBrIzAABCIAQALIANBAUG0pcAAKAIAIgBBAiAAGxEAAAALuAQBBH8jAEHgAmsiAiQAIAJBogJqQgA3AQAgAkGqAmpBADsBACACQawCakIANwIAIAJBtAJqQgA3AgAgAkG8AmpCADcCACACQcQCakIANwIAIAJBzAJqQgA3AgAgAkHUAmpBADoAACACQdUCakEANgAAIAJB2QJqQQA7AAAgAkHbAmpBADoAACACQQA7AZwCIAJBADYBngIgAkHAADYCmAIgAkFAayACQZgCakHEABCLARogAkE4aiACQfwAaikCADcDACACQTBqIAJB9ABqKQIANwMAIAJBKGogAkHsAGopAgA3AwAgAkEgaiACQeQAaikCADcDACACQRhqIAJB3ABqKQIANwMAIAJBEGogAkHUAGopAgA3AwAgAkEIaiACQcwAaikCADcDACACIAIpAkQ3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AABzOgAAIAVBAWoiBUHIAEcNAAsgABAOIAZByABJDQJByAAhBSACQcgAaiECIAhByABqIQgMAAsACyACIARqIgYgBEkNAiAGQcgASw0DIAAgBGpBzAFqIAEgAhCLARogACgCyAEgAmohBwwBCyAAQcwBaiABIARqIAcQiwEaCyAAIAc2AsgBIANBQGskAA8LIAQgBkHAm8AAEH4ACyAGQcgAQcCbwAAQfQALIARByABB0JvAABB+AAsgBCACQeCbwAAQfQALIANBNGpBBjYCACADQSRqQQI2AgAgA0IDNwIUIANBuJ7AADYCECADQQY2AiwgAyADQQxqNgI4IANB3J7AADYCPCADIANBKGo2AiAgAyADQTxqNgIwIAMgA0E4ajYCKCADQRBqQeCewAAQkAEAC5sEAQd/IwBBQGoiAyQAAkACQAJAAkACQAJAAkBB6AAgACgCyAEiBGsiBiACTQRAIAQEQCAEQekATw0GIAAgBGpBzAFqIAEgBhCLARogAiAGayECIAEgBmohAQNAIAAgBWoiBCAELQAAIARBzAFqLQAAczoAACAFQQFqIgVB6ABHDQALIAAQDgsgAiACQegAcCIHayEEIAIgB0kNBiAEQegASQ0BIAFB6ABqIQggASECIAQhBkHoACEFA0AgAyAFNgIMIAVB6ABHDQggBkGYf2ohBkEAIQUDQCAAIAVqIgkgCS0AACACIAVqLQAAczoAACAFQQFqIgVB6ABHDQALIAAQDiAGQegASQ0CQegAIQUgAkHoAGohAiAIQegAaiEIDAALAAsgAiAEaiIGIARJDQIgBkHoAEsNAyAAIARqQcwBaiABIAIQiwEaIAAoAsgBIAJqIQcMAQsgAEHMAWogASAEaiAHEIsBGgsgACAHNgLIASADQUBrJAAPCyAEIAZBwJvAABB+AAsgBkHoAEHAm8AAEH0ACyAEQegAQdCbwAAQfgALIAQgAkHgm8AAEH0ACyADQTRqQQY2AgAgA0EkakECNgIAIANCAzcCFCADQbiewAA2AhAgA0EGNgIsIAMgA0EMajYCOCADQdiewAA2AjwgAyADQShqNgIgIAMgA0E8ajYCMCADIANBOGo2AiggA0EQakHgnsAAEJABAAvkAwEEfyMAQcABayICJAAgAkGiAWpCADcBACACQaoBakEAOwEAIAJBrAFqQgA3AgAgAkG0AWpCADcCACACQQA7AZwBIAJBADYBngEgAkEgNgKYASACQUBrIAJBsAFqKQMANwMAIAJBOGogAkGoAWopAwA3AwAgAkEwaiACQaABaikDADcDACACQcgAaiACQbgBaigCADYCACACIAIpA5gBNwMoIAJBGGogAkE8aikCADcDACACQRBqIAJBNGopAgA3AwAgAkEgaiACQcQAaikCADcDACACIAIpAiw3AwggAkEoaiABQfAAEIsBGiACQShqIAJBCGoQOwJAAkBBIEEBEKEBIgMEQCACQiA3AiwgAiADNgIoIAJBKGogAkEIakEgEF4CQCACKAIsIgQgAigCMCIDRgRAIAQhAwwBCyAEIANJDQIgBEUNACACKAIoIQUCQCADRQRAIAUQEEEBIQQMAQsgBSAEQQEgAxCaASIERQ0ECyACIAM2AiwgAiAENgIoCyACKAIoIQQgARAQIAAgAzYCBCAAIAQ2AgAgAkHAAWokAA8LQSBBAUG0pcAAKAIAIgBBAiAAGxEAAAALQYeMwABBJEGsjMAAEIgBAAsgA0EBQbSlwAAoAgAiAEECIAAbEQAAAAuOBAEFfyMAQYABayICJAAgAkHyAGpCADcBACACQfoAakEAOwEAIAJBADsBbCACQQA2AW4gAkEQNgJoIAJBGGogAkHwAGoiBCkDADcDACACQSBqIAJB+ABqKAIANgIAIAJBCGoiBSACQRxqKQIANwMAIAIgAikDaDcDECACIAIpAhQ3AwAgAkEQaiABQdQAEIsBGgJAAkACQCACKAIQIgNBEEkEQCACQRBqQQRyIgYgA2pBECADayIDIAMQkQEaIAJBADYCECACQSRqIgMgBhALIAQgAkHcAGopAgA3AwAgAiACQdQAaikCADcDaCADIAJB6ABqEAsgBSACQSxqKQIANwMAIAIgAikCJDcDAEEQQQEQoQEiA0UNASACQhA3AhQgAiADNgIQIAJBEGogAkEQEF4CQCACKAIUIgQgAigCGCIDRgRAIAQhAwwBCyAEIANJDQMgBEUNACACKAIQIQUCQCADRQRAIAUQEEEBIQQMAQsgBSAEQQEgAxCaASIERQ0FCyACIAM2AhQgAiAENgIQCyACKAIQIQQgARAQIAAgAzYCBCAAIAQ2AgAgAkGAAWokAA8LQbCawABBFyACQegAakGgl8AAQbCXwAAQeQALQRBBAUG0pcAAKAIAIgBBAiAAGxEAAAALQYeMwABBJEGsjMAAEIgBAAsgA0EBQbSlwAAoAgAiAEECIAAbEQAAAAuFBAEEfyMAQdAAayICJAAgAkEqakIANwEAIAJBMmpBADsBACACQRQ2AiAgAkE0akEANgIAIAJBADsBJCACQQA2ASYgAkHIAGogAkEwaikDADcDACACQUBrIAJBKGopAwA3AwAgAkEQaiACQcQAaikCADcDACACQRhqIAJBzABqKAIANgIAIAIgAikDIDcDOCACIAIpAjw3AwggASACQQhqEFogAUIANwMAIAFBADYCHCABQfiXwAApAwA3AwggAUEQakGAmMAAKQMANwMAIAFBGGpBiJjAACgCADYCAAJAAkBBFEEBEKEBIgMEQCACQhQ3AjwgAiADNgI4IAJBOGogAkEIakEUEF4CQCACKAI8IgQgAigCQCIDRgRAIAQhAwwBCyAEIANJDQIgBEUNACACKAI4IQUCQCADRQRAIAUQEEEBIQQMAQsgBSAEQQEgAxCaASIERQ0ECyACIAM2AjwgAiAENgI4CyACKAI4IQQgAUIANwMAIAFBADYCHCABQQhqIgFB+JfAACkDADcDACABQQhqQYCYwAApAwA3AwAgAUEQakGImMAAKAIANgIAIAAgAzYCBCAAIAQ2AgAgAkHQAGokAA8LQRRBAUG0pcAAKAIAIgBBAiAAGxEAAAALQYeMwABBJEGsjMAAEIgBAAsgA0EBQbSlwAAoAgAiAEECIAAbEQAAAAuFBAEEfyMAQdAAayICJAAgAkEqakIANwEAIAJBMmpBADsBACACQRQ2AiAgAkE0akEANgIAIAJBADsBJCACQQA2ASYgAkHIAGogAkEwaikDADcDACACQUBrIAJBKGopAwA3AwAgAkEQaiACQcQAaikCADcDACACQRhqIAJBzABqKAIANgIAIAIgAikDIDcDOCACIAIpAjw3AwggASACQQhqECAgAUEANgIcIAFCADcDACABQRhqQYiYwAAoAgA2AgAgAUEQakGAmMAAKQMANwMAIAFB+JfAACkDADcDCAJAAkBBFEEBEKEBIgMEQCACQhQ3AjwgAiADNgI4IAJBOGogAkEIakEUEF4CQCACKAI8IgQgAigCQCIDRgRAIAQhAwwBCyAEIANJDQIgBEUNACACKAI4IQUCQCADRQRAIAUQEEEBIQQMAQsgBSAEQQEgAxCaASIERQ0ECyACIAM2AjwgAiAENgI4CyACKAI4IQQgAUEANgIcIAFCADcDACABQQhqIgFBEGpBiJjAACgCADYCACABQQhqQYCYwAApAwA3AwAgAUH4l8AAKQMANwMAIAAgAzYCBCAAIAQ2AgAgAkHQAGokAA8LQRRBAUG0pcAAKAIAIgBBAiAAGxEAAAALQYeMwABBJEGsjMAAEIgBAAsgA0EBQbSlwAAoAgAiAEECIAAbEQAAAAvlAwEEfyMAQfAAayICJAAgAkEqakIANwEAIAJBMmpBADsBACACQTRqQgA3AgAgAkE8akIANwIAIAJBADsBJCACQQA2ASYgAkEgNgIgIAJB4ABqIAJBOGopAwA3AwAgAkHYAGogAkEwaikDADcDACACQdAAaiACQShqKQMANwMAIAJB6ABqIAJBQGsoAgA2AgAgAiACKQMgNwNIIAJBEGogAkHcAGopAgA3AwAgAkEIaiACQdQAaikCADcDACACQRhqIAJB5ABqKQIANwMAIAIgAikCTDcDACABIAIQZiABQQBByAEQkQEiBUEANgLIAQJAAkBBIEEBEKEBIgEEQCACQiA3AkwgAiABNgJIIAJByABqIAJBIBBeAkAgAigCTCIDIAIoAlAiAUYEQCADIQEMAQsgAyABSQ0CIANFDQAgAigCSCEEAkAgAUUEQCAEEBBBASEDDAELIAQgA0EBIAEQmgEiA0UNBAsgAiABNgJMIAIgAzYCSAsgAigCSCEDIAVBAEHIARCRAUEANgLIASAAIAE2AgQgACADNgIAIAJB8ABqJAAPC0EgQQFBtKXAACgCACIAQQIgABsRAAAAC0GHjMAAQSRBrIzAABCIAQALIAFBAUG0pcAAKAIAIgBBAiAAGxEAAAAL5QMBBH8jAEHwAGsiAiQAIAJBKmpCADcBACACQTJqQQA7AQAgAkE0akIANwIAIAJBPGpCADcCACACQQA7ASQgAkEANgEmIAJBIDYCICACQeAAaiACQThqKQMANwMAIAJB2ABqIAJBMGopAwA3AwAgAkHQAGogAkEoaikDADcDACACQegAaiACQUBrKAIANgIAIAIgAikDIDcDSCACQRBqIAJB3ABqKQIANwMAIAJBCGogAkHUAGopAgA3AwAgAkEYaiACQeQAaikCADcDACACIAIpAkw3AwAgASACEGcgAUEAQcgBEJEBIgVBADYCyAECQAJAQSBBARChASIBBEAgAkIgNwJMIAIgATYCSCACQcgAaiACQSAQXgJAIAIoAkwiAyACKAJQIgFGBEAgAyEBDAELIAMgAUkNAiADRQ0AIAIoAkghBAJAIAFFBEAgBBAQQQEhAwwBCyAEIANBASABEJoBIgNFDQQLIAIgATYCTCACIAM2AkgLIAIoAkghAyAFQQBByAEQkQFBADYCyAEgACABNgIEIAAgAzYCACACQfAAaiQADwtBIEEBQbSlwAAoAgAiAEECIAAbEQAAAAtBh4zAAEEkQayMwAAQiAEACyABQQFBtKXAACgCACIAQQIgABsRAAAAC9wDAQR/IwBBoANrIgIkACACQYIDakIANwEAIAJBigNqQQA7AQAgAkGMA2pCADcCACACQZQDakIANwIAIAJBADsB/AIgAkEANgH+AiACQSA2AvgCIAJBOGogAkGQA2opAwA3AwAgAkEwaiACQYgDaikDADcDACACQShqIAJBgANqKQMANwMAIAJBQGsgAkGYA2ooAgA2AgAgAiACKQP4AjcDICACQRBqIAJBNGopAgA3AwAgAkEIaiACQSxqKQIANwMAIAJBGGogAkE8aikCADcDACACIAIpAiQ3AwAgAkEgaiABQdgCEIsBGiACQSBqIAIQZgJAAkBBIEEBEKEBIgMEQCACQiA3AiQgAiADNgIgIAJBIGogAkEgEF4CQCACKAIkIgQgAigCKCIDRgRAIAQhAwwBCyAEIANJDQIgBEUNACACKAIgIQUCQCADRQRAIAUQEEEBIQQMAQsgBSAEQQEgAxCaASIERQ0ECyACIAM2AiQgAiAENgIgCyACKAIgIQQgARAQIAAgAzYCBCAAIAQ2AgAgAkGgA2okAA8LQSBBAUG0pcAAKAIAIgBBAiAAGxEAAAALQYeMwABBJEGsjMAAEIgBAAsgA0EBQbSlwAAoAgAiAEECIAAbEQAAAAvcAwEEfyMAQaADayICJAAgAkGCA2pCADcBACACQYoDakEAOwEAIAJBjANqQgA3AgAgAkGUA2pCADcCACACQQA7AfwCIAJBADYB/gIgAkEgNgL4AiACQThqIAJBkANqKQMANwMAIAJBMGogAkGIA2opAwA3AwAgAkEoaiACQYADaikDADcDACACQUBrIAJBmANqKAIANgIAIAIgAikD+AI3AyAgAkEQaiACQTRqKQIANwMAIAJBCGogAkEsaikCADcDACACQRhqIAJBPGopAgA3AwAgAiACKQIkNwMAIAJBIGogAUHYAhCLARogAkEgaiACEGcCQAJAQSBBARChASIDBEAgAkIgNwIkIAIgAzYCICACQSBqIAJBIBBeAkAgAigCJCIEIAIoAigiA0YEQCAEIQMMAQsgBCADSQ0CIARFDQAgAigCICEFAkAgA0UEQCAFEBBBASEEDAELIAUgBEEBIAMQmgEiBEUNBAsgAiADNgIkIAIgBDYCIAsgAigCICEEIAEQECAAIAM2AgQgACAENgIAIAJBoANqJAAPC0EgQQFBtKXAACgCACIAQQIgABsRAAAAC0GHjMAAQSRBrIzAABCIAQALIANBAUG0pcAAKAIAIgBBAiAAGxEAAAAL0wMBBH8jAEHgAGsiAiQAIAJBKmpCADcBACACQTJqQQA7AQAgAkE0akIANwIAIAJBHDYCICACQTxqQQA2AgAgAkEAOwEkIAJBADYBJiACQdgAaiACQThqKQMANwMAIAJB0ABqIAJBMGopAwA3AwAgAkHIAGogAkEoaikDADcDACACIAIpAyA3A0AgAkEYaiACQdwAaigCADYCACACQRBqIAJB1ABqKQIANwMAIAJBCGogAkHMAGopAgA3AwAgAiACKQJENwMAIAEgAhBoIAFBAEHIARCRASIFQQA2AsgBAkACQEEcQQEQoQEiAQRAIAJCHDcCRCACIAE2AkAgAkFAayACQRwQXgJAIAIoAkQiAyACKAJIIgFGBEAgAyEBDAELIAMgAUkNAiADRQ0AIAIoAkAhBAJAIAFFBEAgBBAQQQEhAwwBCyAEIANBASABEJoBIgNFDQQLIAIgATYCRCACIAM2AkALIAIoAkAhAyAFQQBByAEQkQFBADYCyAEgACABNgIEIAAgAzYCACACQeAAaiQADwtBHEEBQbSlwAAoAgAiAEECIAAbEQAAAAtBh4zAAEEkQayMwAAQiAEACyABQQFBtKXAACgCACIAQQIgABsRAAAAC9MDAQR/IwBB4ABrIgIkACACQSpqQgA3AQAgAkEyakEAOwEAIAJBNGpCADcCACACQRw2AiAgAkE8akEANgIAIAJBADsBJCACQQA2ASYgAkHYAGogAkE4aikDADcDACACQdAAaiACQTBqKQMANwMAIAJByABqIAJBKGopAwA3AwAgAiACKQMgNwNAIAJBGGogAkHcAGooAgA2AgAgAkEQaiACQdQAaikCADcDACACQQhqIAJBzABqKQIANwMAIAIgAikCRDcDACABIAIQaSABQQBByAEQkQEiBUEANgLIAQJAAkBBHEEBEKEBIgEEQCACQhw3AkQgAiABNgJAIAJBQGsgAkEcEF4CQCACKAJEIgMgAigCSCIBRgRAIAMhAQwBCyADIAFJDQIgA0UNACACKAJAIQQCQCABRQRAIAQQEEEBIQMMAQsgBCADQQEgARCaASIDRQ0ECyACIAE2AkQgAiADNgJACyACKAJAIQMgBUEAQcgBEJEBQQA2AsgBIAAgATYCBCAAIAM2AgAgAkHgAGokAA8LQRxBAUG0pcAAKAIAIgBBAiAAGxEAAAALQYeMwABBJEGsjMAAEIgBAAsgAUEBQbSlwAAoAgAiAEECIAAbEQAAAAvkAwIJfwF+IwBBoAFrIgIkACACQUBrIAFBBGoQciABKAIAIQggAkH4AGoiAyABQTxqKQAANwMAIAJB8ABqIgQgAUE0aikAADcDACACQegAaiIFIAFBLGopAAA3AwAgAkHgAGoiBiABQSRqKQAANwMAIAJB2ABqIgcgAUEcaikAADcDACACIAEpABQ3A1AgAkGQAWogAUHEAGoQciACQQhqIgkgBykDADcDACACQRBqIgcgBikDADcDACACQRhqIgYgBSkDADcDACACQSBqIgUgBCkDADcDACACQShqIgQgAykDADcDACACQTBqIgMgAikDkAEiCzcDACACQThqIgogAkGYAWopAwA3AwAgAiALNwOAASACIAIpA1A3AwBB1ABBBBChASIBRQRAQdQAQQRBtKXAACgCACIAQQIgABsRAAAACyABIAg2AgAgASACKQNANwIEIAEgAikDADcCFCABQQxqIAJByABqKQMANwIAIAFBHGogCSkDADcCACABQSRqIAcpAwA3AgAgAUEsaiAGKQMANwIAIAFBNGogBSkDADcCACABQTxqIAQpAwA3AgAgAUHEAGogAykDADcCACABQcwAaiAKKQMANwIAIABB9I/AADYCBCAAIAE2AgAgAkGgAWokAAvLAwEEfyMAQaADayICJAAgAkGKA2pCADcBACACQZIDakEAOwEAIAJBlANqQgA3AgAgAkEcNgKAAyACQZwDakEANgIAIAJBADsBhAMgAkEANgGGAyACQThqIAJBmANqKQMANwMAIAJBMGogAkGQA2opAwA3AwAgAkEoaiACQYgDaikDADcDACACIAIpA4ADNwMgIAJBGGogAkE8aigCADYCACACQRBqIAJBNGopAgA3AwAgAkEIaiACQSxqKQIANwMAIAIgAikCJDcDACACQSBqIAFB4AIQiwEaIAJBIGogAhBpAkACQEEcQQEQoQEiAwRAIAJCHDcCJCACIAM2AiAgAkEgaiACQRwQXgJAIAIoAiQiBCACKAIoIgNGBEAgBCEDDAELIAQgA0kNAiAERQ0AIAIoAiAhBQJAIANFBEAgBRAQQQEhBAwBCyAFIARBASADEJoBIgRFDQQLIAIgAzYCJCACIAQ2AiALIAIoAiAhBCABEBAgACADNgIEIAAgBDYCACACQaADaiQADwtBHEEBQbSlwAAoAgAiAEECIAAbEQAAAAtBh4zAAEEkQayMwAAQiAEACyADQQFBtKXAACgCACIAQQIgABsRAAAAC8sDAQR/IwBBoANrIgIkACACQYoDakIANwEAIAJBkgNqQQA7AQAgAkGUA2pCADcCACACQRw2AoADIAJBnANqQQA2AgAgAkEAOwGEAyACQQA2AYYDIAJBOGogAkGYA2opAwA3AwAgAkEwaiACQZADaikDADcDACACQShqIAJBiANqKQMANwMAIAIgAikDgAM3AyAgAkEYaiACQTxqKAIANgIAIAJBEGogAkE0aikCADcDACACQQhqIAJBLGopAgA3AwAgAiACKQIkNwMAIAJBIGogAUHgAhCLARogAkEgaiACEGgCQAJAQRxBARChASIDBEAgAkIcNwIkIAIgAzYCICACQSBqIAJBHBBeAkAgAigCJCIEIAIoAigiA0YEQCAEIQMMAQsgBCADSQ0CIARFDQAgAigCICEFAkAgA0UEQCAFEBBBASEEDAELIAUgBEEBIAMQmgEiBEUNBAsgAiADNgIkIAIgBDYCIAsgAigCICEEIAEQECAAIAM2AgQgACAENgIAIAJBoANqJAAPC0EcQQFBtKXAACgCACIAQQIgABsRAAAAC0GHjMAAQSRBrIzAABCIAQALIANBAUG0pcAAKAIAIgBBAiAAGxEAAAALywMBBH8jAEGwAWsiAiQAIAJBmgFqQgA3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HCIEayIFIAJNBEAgAEEIaiEHIAQEQCAEQcEATw0GIAQgAEEgaiIEaiABIAUQiwEaIAcgBBAHIAIgBWshAiABIAVqIQELIAJBP3EhBSACQUBxIghBwABJDQEgAiAFa0FAaiEGIAEhBEHAACECA0AgAyACNgIMIAJBwABHDQcgByAEEAcgBkHAAEkNAiAEQUBrIQQgBkFAaiEGDAALAAsgAiAEaiIFIARJDQIgBUHAAEsNAyAAIARqQSBqIAEgAhCLARogACgCHCACaiEFDAELIABBIGogASAIaiAFEIsBGgsgACAFNgIcIANBQGskAA8LIAQgBUHAm8AAEH4ACyAFQcAAQcCbwAAQfQALIARBwABB0JvAABB+AAsgA0E0akEGNgIAIANBJGpBAjYCACADQgM3AhQgA0G4nsAANgIQIANBBjYCLCADIANBDGo2AjggA0GsjcAANgI8IAMgA0EoajYCICADIANBPGo2AjAgAyADQThqNgIoIANBEGpB4J7AABCQAQALtAMBBn8jAEFAaiIDJAAgACAAKQMAIAKtfDcDAAJAAkACQAJAAkACQEHAACAAKAIIIgRrIgUgAk0EQCAAQcwAaiEHIAQEQCAEQcEATw0GIAQgAEEMaiIEaiABIAUQiwEaIAcgBBAKIAIgBWshAiABIAVqIQELIAJBP3EhBSACQUBxIghBwABJDQEgAiAFa0FAaiEGIAEhBEHAACECA0AgAyACNgIMIAJBwABHDQcgByAEEAogBkHAAEkNAiAEQUBrIQQgBkFAaiEGDAALAAsgAiAEaiIFIARJDQIgBUHAAEsNAyAAIARqQQxqIAEgAhCLARogACgCCCACaiEFDAELIABBDGogASAIaiAFEIsBGgsgACAFNgIIIANBQGskAA8LIAQgBUHAm8AAEH4ACyAFQcAAQcCbwAAQfQALIARBwABB0JvAABB+AAsgA0E0akEGNgIAIANBJGpBAjYCACADQgM3AhQgA0G4nsAANgIQIANBBjYCLCADIANBDGo2AjggA0GsjcAANgI8IAMgA0EoajYCICADIANBPGo2AjAgAyADQThqNgIoIANBEGpB4J7AABCQAQAL0QMCBX8CfiAAQdQAaiECIABBEGohAyAAQQhqKQMAIQYgACkDACEHAkACQCAAKAJQIgFBgAFGBEAgAyACQQEQDEEAIQEgAEEA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AXFyQQJyNgIEIAAgA2oiAyADKAIEQQFyNgIEIAUgAiAFKAIAQQFxckECcjYCACAAIAAoAgRBAXI2AgQgASACEBQMAQsgASgCACEBIAAgAzYCBCAAIAEgAmo2AgALAkAgAEEEaigCACIBQQNxRQ0AIAFBeHEiAiAEQRBqTQ0AIABBBGogBCABQQFxckECcjYCACAAIARqIgEgAiAEayIEQQNyNgIEIAAgAmoiAiACKAIEQQFyNgIEIAEgBBAUCyAAQQhqIQMLIAMLiwMCBn8BfiMAQfAAayICJAAgAkHQAGoiAyABQRBqKQMANwMAIAJB2ABqIgQgAUEYaikDADcDACACQeAAaiIFIAFBIGopAwA3AwAgAkHoAGoiBiABQShqKQMANwMAIAIgASkDCDcDSCABKQMAIQggAkEIaiABQTRqEGUgASgCMCEHQfgAQQgQoQEiAUUEQEH4AEEIQbSlwAAoAgAiAEECIAAbEQAAAAsgASAINwMAIAEgAikDSDcDCCABIAc2AjAgASACKQMINwI0IAFBEGogAykDADcDACABQRhqIAQpAwA3AwAgAUEgaiAFKQMANwMAIAFBKGogBikDADcDACABQTxqIAJBEGopAwA3AgAgAUHEAGogAkEYaikDADcCACABQcwAaiACQSBqKQMANwIAIAFB1ABqIAJBKGopAwA3AgAgAUHcAGogAkEwaikDADcCACABQeQAaiACQThqKQMANwIAIAFB7ABqIAJBQGspAwA3AgAgAEHgjMAANgIEIAAgATYCACACQfAAaiQAC4YDAQR/IwBBkAFrIgIkACACQYIBakIANwEAIAJBigFqQQA7AQAgAkEAOwF8IAJBADYBfiACQRA2AnggAkEgaiACQYABaikDADcDACACQShqIAJBiAFqKAIANgIAIAJBEGogAkEkaikCADcDACACIAIpA3g3AxggAiACKQIcNwMIIAJBGGogAUHgABCLARogAkEYaiACQQhqEF0CQAJAQRBBARChASIDBEAgAkIQNwIcIAIgAzYCGCACQRhqIAJBCGpBEBBeAkAgAigCHCIEIAIoAiAiA0YEQCAEIQMMAQsgBCADSQ0CIARFDQAgAigCGCEFAkAgA0UEQCAFEBBBASEEDAELIAUgBEEBIAMQmgEiBEUNBAsgAiADNgIcIAIgBDYCGAsgAigCGCEEIAEQ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QT8gBmsQkQEaQcAAIAAoAjBrQQdNBEAgBCADEAYgACgCMCICQcEATw0CIABBNGpBACACEJEBGgsgAEHsAGogB0IDhjcCACAEIAMQBiAAQQA2AjAgASAAKAIINgAAIAEgAEEMaigCADYABCABIABBEGooAgA2AAggASAAQRRqKAIANgAMIAEgAEEYaigCADYAECABIABBHGooAgA2ABQgASAAQSBqKAIANgAYIAEgAEEkaigCADYAHCABIABBKGooAgA2ACAgASAAQSxqKAIANgAkDwsgAkHAAEGAmsAAEH4ACyACQcAAQZCawAAQfQALIAJBwABBoJrAABB8AAvwAgIGfwF+IwBBEGsiBCQAIABBDGohBSAAQcwAaiEDIAApAwAhCAJAAkAgACgCCCICQcAARgRAIAMgBRAKQQAhAiAAQQA2AggMAQsgAkE/Sw0BCyAAQQhqIgYgAmpBBGpBgAE6AAAgACAAKAIIIgdBAWoiAjYCCAJAIAJBwQBJBEAgAiAGakEEakEAQT8gB2sQkQEaQcAAIAAoAghrQQdNBEAgAyAFEAogACgCCCICQcEATw0CIABBDGpBACACEJEBGgsgAEHEAGogCEIDhjcCACADIAUQCiAAQQA2AgggBEEIaiICIABB3ABqNgIEIAIgAzYCACAEKAIMIAQoAggiAGtBAnYiA0EEIANBBEkbIgIEQEEAIQMDQCABIAAoAgA2AAAgAEEEaiEAIAFBBGohASADQQFqIgMgAkkNAAsLIARBEGokAA8LIAJBwABBgJrAABB+AAsgAkHAAEGQmsAAEH0ACyACQcAAQaCawAAQfAAL1AIBAX8gABBUIAEgACgCTCICQRh0IAJBCHRBgID8B3FyIAJBCHZBgP4DcSACQRh2cnI2AAAgASAAQdAAaigCACICQRh0IAJBCHRBgID8B3FyIAJBCHZBgP4DcSACQRh2cnI2AAQgASAAQdQAaigCACICQRh0IAJBCHRBgID8B3FyIAJBCHZBgP4DcSACQRh2cnI2AAggASAAQdgAaigCACICQRh0IAJBCHRBgID8B3FyIAJBCHZBgP4DcSACQRh2cnI2AAwgASAAQdwAaigCACICQRh0IAJBCHRBgID8B3FyIAJBCHZBgP4DcSACQRh2cnI2ABAgASAAQeAAaigCACICQRh0IAJBCHRBgID8B3FyIAJBCHZBgP4DcSACQRh2cnI2ABQgASAAQeQAaigCACIAQRh0IABBCHRBgID8B3FyIABBCHZBgP4DcSAAQRh2cnI2ABgL7AICBX8BfiMAQeAAayICJAAgASkDACEHIAJBIGogAUEMahBlIAJBCGoiAyABQdQAaikCADcDACACQRBqIgQgAUHcAGopAgA3AwAgAkEYaiIFIAFB5ABqKQIANwMAIAIgASkCTDcDACABKAIIIQZB8ABBCBChASIBRQRAQfAAQQhBtKXAACgCACIAQQIgABsRAAAACyABIAY2AgggASAHNwMAIAEgAikDIDcCDCABQRRqIAJBKGopAwA3AgAgAUEcaiACQTBqKQMANwIAIAFBJGogAkE4aikDADcCACABQSxqIAJBQGspAwA3AgAgAUE0aiACQcgAaikDADcCACABQTxqIAJB0ABqKQMANwIAIAFBxABqIAJB2ABqKQMANwIAIAFB5ABqIAUpAwA3AgAgAUHcAGogBCkDADcCACABQdQAaiADKQMANwIAIAEgAikDADcCTCAAQeCQwAA2AgQgACABNgIAIAJB4ABqJAAL7AICBX8BfiMAQeAAayICJAAgASkDACEHIAJBIGogAUEMahBlIAJBCGoiAyABQdQAaikCADcDACACQRBqIgQgAUHcAGopAgA3AwAgAkEYaiIFIAFB5ABqKQIANwMAIAIgASkCTDcDACABKAIIIQZB8ABBCBChASIBRQRAQfAAQQhBtKXAACgCACIAQQIgABsRAAAACyABIAY2AgggASAHNwMAIAEgAikDIDcCDCABQRRqIAJBKGopAwA3AgAgAUEcaiACQTBqKQMANwIAIAFBJGogAkE4aikDADcCACABQSxqIAJBQGspAwA3AgAgAUE0aiACQcgAaikDADcCACABQTxqIAJB0ABqKQMANwIAIAFBxABqIAJB2ABqKQMANwIAIAFB5ABqIAUpAwA3AgAgAUHcAGogBCkDADcCACABQdQAaiADKQMANwIAIAEgAikDADcCTCAAQYSRwAA2AgQgACABNgIAIAJB4ABqJAALyAICBH8BfiMAQeAAayICJAAgAkHQAGoiAyABQRBqKQMANwMAIAJB2ABqIgQgAUEYaigCADYCACACIAEpAwg3A0ggASkDACEGIAJBCGogAUEgahBlIAEoAhwhBUHgAEEIEKEBIgFFBEBB4ABBCEG0pcAAKAIAIgBBAiAAGxEAAAALIAEgBjcDACABIAIpA0g3AwggASAFNgIcIAEgAikDCDcDICABQRBqIAMpAwA3AwAgAUEYaiAEKAIANgIAIAFBKGogAkEQaikDADcDACABQTBqIAJBGGopAwA3AwAgAUE4aiACQSBqKQMANwMAIAFBQGsgAkEoaikDADcDACABQcgAaiACQTBqKQMANwMAIAFB0ABqIAJBOGopAwA3AwAgAUHYAGogAkFAaykDADcDACAAQYSNwAA2AgQgACABNgIAIAJB4ABqJAALyAICBH8BfiMAQeAAayICJAAgAkHQAGoiAyABQRBqKQMANwMAIAJB2ABqIgQgAUEYaigCADYCACACIAEpAwg3A0ggASkDACEGIAJBCGogAUEgahBlIAEoAhwhBUHgAEEIEKEBIgFFBEBB4ABBCEG0pcAAKAIAIgBBAiAAGxEAAAALIAEgBjcDACABIAIpA0g3AwggASAFNgIcIAEgAikDCDcDICABQRBqIAMpAwA3AwAgAUEYaiAEKAIANgIAIAFBKGogAkEQaikDADcDACABQTBqIAJBGGopAwA3AwAgAUE4aiACQSBqKQMANwMAIAFBQGsgAkEoaikDADcDACABQcgAaiACQTBqKQMANwMAIAFB0ABqIAJBOGopAwA3AwAgAUHYAGogAkFAaykDADcDACAAQbCNwAA2AgQgACABNgIAIAJB4ABqJAAL3QICBX8BfiAAQQxqIQIgAEHMAGohAyAAKQMAIQYCQAJAIAAoAggiAUHAAEYEQCADIAJBARAEQQAhASAAQQA2AggMAQsgAUE/Sw0BCyAAQQhqIgQgAWpBBGpBgAE6AAAgACAAKAIIIgVBAWoiATYCCAJAIAFBwQBJBEAgASAEakEEakEAQT8gBWsQkQEaQcAAIAAoAghrQQdNBEAgAyACQQEQBCAAKAIIIgFBwQBPDQIgAEEMakEAIAEQkQEaCyAAQcQAaiAGQiiGQoCAgICAgMD/AIMgBkI4hoQgBkIYhkKAgICAgOA/gyAGQgiGQoCAgIDwH4OEhCAGQgiIQoCAgPgPgyAGQhiIQoCA/AeDhCAGQiiIQoD+A4MgBkI4iISEhDcCACADIAJBARAEIABBADYCCA8LIAFBwABBgJrAABB+AAsgAUHAAEGQmsAAEH0ACyABQcAAQaCawAAQfAALvgICBX8BfiMAQTBrIgQkAEEnIQICQCAAQpDOAFQEQCAAIQcMAQsDQCAEQQlqIAJqIgNBfGogACAAQpDOAIAiB0LwsX9+fKciBUH//wNxQeQAbiIGQQF0QdqIwABqLwAAOwAAIANBfmogBkGcf2wgBWpB//8DcUEBdEHaiMAAai8AADsAACACQXxqIQIgAEL/wdcvViAHIQANAAsLIAenIgNB4wBKBEAgAkF+aiICIARBCWpqIAenIgVB//8DcUHkAG4iA0Gcf2wgBWpB//8DcUEBdEHaiMAAai8AADsAAAsCQCADQQpOBEAgAkF+aiICIARBCWpqIANBAXRB2ojAAGovAAA7AAAMAQsgAkF/aiICIARBCWpqIANBMGo6AAALIAFByKDAAEEAIARBCWogAmpBJyACaxAYIARBMGokAAu/AgEDfyMAQRBrIgIkAAJAIAAoAgAiAAJ/AkAgAUGAAU8EQCACQQA2AgwgAUGAEEkNASABQYCABEkEQCACIAFBP3FBgAFyOgAOIAIgAUEMdkHgAXI6AAwgAiABQQZ2QT9xQYABcjoADUEDDAMLIAIgAUE/cUGAAXI6AA8gAiABQRJ2QfABcjoADCACIAFBBnZBP3FBgAFyOgAOIAIgAUEMdkE/cUGAAXI6AA1BBAwCCyAAKAIIIgMgAEEEaigCAEYEfyAAQQEQaiAAKAIIBSADCyAAKAIAaiABOgAAIAAgACgCCEEBajYCCAwCCyACIAFBP3FBgAFyOgANIAIgAUEGdkHAAXI6AAxBAgsiARBqIABBCGoiAygCACIEIAAoAgBqIAJBDGogARCLARogAyABIARqNgIACyACQRBqJABBAAvLAgEIfyMAQYABayIBQShqIgJCADcDACABQSBqIgNCADcDACABQRhqIgRCADcDACABQRBqIgVCADcDACABQQhqIgZCADcDACABQgA3AwAgAUHaAGpCADcBACABQeIAakEAOwEAIAFBEDYCUCABQQA7AVQgAUEANgFWIAFB+ABqIAFB4ABqKAIANgIAIAFB8ABqIAFB2ABqKQMANwMAIAFByABqIgcgAUH0AGopAgA3AwAgASABKQNQNwNoIAEgASkCbDcDQCABQThqIgggBykDADcDACABIAEpA0A3AzAgAEHMAGogCCkDADcAACAAQcQAaiABKQMwNwAAIABBPGogAikDADcAACAAQTRqIAMpAwA3AAAgAEEsaiAEKQMANwAAIABBJGogBSkDADcAACAAQRxqIAYpAwA3AAAgACABKQMANwAUIABBADYCAAuxAgEDfyMAQYABayIEJAAgACgCACEAAkACQAJ/AkAgASgCACIDQRBxRQRAIAAoAgAhAiADQSBxDQEgAq0gARBVDAILIAAoAgAhAkEAIQADQCAAIARqQf8AaiACQQ9xIgNBMHIgA0HXAGogA0EKSRs6AAAgAEF/aiEAIAJBBHYiAg0ACyAAQYABaiICQYEBTw0CIAFB2IvAAEECIAAgBGpBgAFqQQAgAGsQGAwBC0EAIQADQCAAIARqQf8AaiACQQ9xIgNBMHIgA0E3aiADQQpJGzoAACAAQX9qIQAgAkEEdiICDQALIABBgAFqIgJBgQFPDQIgAUHYi8AAQQIgACAEakGAAWpBACAAaxAYCyAEQYABaiQADwsgAkGAAUHIi8AAEH4ACyACQYABQciLwAAQfgALrAICA38CfiAAIAApAwAiBiACrUIDhnwiBzcDACAAQQhqIgMgAykDACAHIAZUrXw3AwACQAJAQYABIAAoAlAiA2siBCACTQRAIABBEGoiBSADBEAgA0GBAU8NAiADIABB1ABqIgNqIAEgBBCLARogAEEANgJQIAUgA0EBEAwgAiAEayECIAEgBGohAQsgASACQQd2EAwgAkH/AHEiA0GBAU8NAiAAQdQAaiABIAJBgH9xaiADEIsBGiAAIAM2AlAPCwJAIAIgA2oiBCADTwRAIARBgAFLDQEgACADakHUAGogASACEIsBGiAAIAAoAlAgAmo2AlAPCyADIARB0JnAABB+AAsgBEGAAUHQmcAAEH0ACyADQYABQeCZwAAQfgALIANBgAFB8JnAABB9AAu8AgIFfwF+IABBIGohAyAAQQhqIQQgACkDACEHAkACQCAAKAIcIgJBwABGBEAgBCADEAdBACECIABBADYCHAwBCyACQT9LDQELIABBHGoiBSACakEEakGAAToAACAAIAAoAhwiBkEBaiICNgIcAkAgAkHBAEkEQCACIAVqQQRqQQBBPyAGaxCRARpBwAAgACgCHGtBB00EQCAEIAMQByAAKAIcIgJBwQBPDQIgAEEgakEAIAIQkQEaCyAAQdgAaiAHQgOGNwIAIAQgAxAHIABBADYCHCABIAAoAgg2AAAgASAAQQxqKAIANgAEIAEgAEEQaigCADYACCABIABBFGooAgA2AAwgASAAQRhqKAIANgAQDwsgAkHAAEGAmsAAEH4ACyACQcAAQZCawAAQfQALIAJBwABBoJrAABB8AAu1AgEDfyMAQRBrIgQkACAAKALIASICQccATQRAIAAgAmpBzAFqQQY6AAAgAkEBaiIDQcgARwRAIAAgA2pBzAFqQQBBxwAgAmsQkQEaC0EAIQIgAEEANgLIASAAQZMCaiIDIAMtAABBgAFyOgAAA0AgACACaiIDIAMtAAAgA0HMAWotAABzOgAAIAJBAWoiAkHIAEcNAAsgABAOIAEgACkAADcAACABQThqIABBOGopAAA3AAAgAUEwaiAAQTBqKQAANwAAIAFBKGogAEEoaikAADcAACABQSBqIABBIGopAAA3AAAgAUEYaiAAQRhqKQAANwAAIAFBEGogAEEQaikAADcAACABQQhqIABBCGopAAA3AAAgBEEQaiQADwtBsJrAAEEXIARBCGpByJrAAEGknsAAEHkAC7UCAQN/IwBBEGsiBCQAIAAoAsgBIgJBxwBNBEAgACACakHMAWpBAToAACACQQFqIgNByABHBEAgACADakHMAWpBAEHHACACaxCRARoLQQAhAiAAQQA2AsgBIABBkwJqIgMgAy0AAEGAAXI6AAADQCAAIAJqIgMgAy0AACADQcwBai0AAHM6AAAgAkEBaiICQcgARw0ACyAAEA4gASAAKQAANwAAIAFBOGogAEE4aikAADcAACABQTBqIABBMGopAAA3AAAgAUEoaiAAQShqKQAANwAAIAFBIGogAEEgaikAADcAACABQRhqIABBGGopAAA3AAAgAUEQaiAAQRBqKQAANwAAIAFBCGogAEEIaikAADcAACAEQRBqJAAPC0GwmsAAQRcgBEEIakHImsAAQeSdwAAQeQALswICBX8BfiAAQQxqIQMgAEHMAGohBCAAKQMAIQcCQAJAIAAoAggiAkHAAEYEQCAEIAMQDUEAIQIgAEEANgIIDAELIAJBP0sNAQsgAEEIaiIFIAJqQQRqQYABOgAAIAAgACgCCCIGQQFqIgI2AggCQCACQcEASQRAIAIgBWpBBGpBAEE/IAZrEJEBGkHAACAAKAIIa0EHTQRAIAQgAxANIAAoAggiAkHBAE8NAiAAQQxqQQAgAhCRARoLIABBxABqIAdCA4Y3AgAgBCADEA0gAEEANgIIIAEgACgCTDYAACABIABB0ABqKAIANgAEIAEgAEHUAGooAgA2AAggASAAQdgAaigCADYADA8LIAJBwABBgJrAABB+AAsgAkHAAEGQmsAAEH0ACyACQcAAQaCawAAQfAALhgIBBH8CQCAAQQRqKAIAIgYgAEEIaigCACIFayACTwRAIAAoAgAhBAwBCwJAAn8gAiAFaiIDIAVPBEBBACAGQQF0IgUgAyAFIANLGyIDQQggA0EISxsiA0EASA0BGgJAIAAoAgBBACAGGyIERQRAIANBARChASIEDQQMAQsgAyAGRg0DIAZFBEAgA0EBEKEBIgRFDQEMBAsgBCAGQQEgAxCaASIEDQMLQQEMAQtBAAsiBARAIAMgBEG0pcAAKAIAIgBBAiAAGxEAAAALEJsBAAsgACAENgIAIABBBGogAzYCACAAQQhqKAIAIQULIAQgBWogASACEIsBGiAAQQhqIAIgBWo2AgALjAIBA38gACAAKQMAIAKtQgOGfDcDAAJAAkBBwAAgACgCCCIDayIEIAJNBEAgAEHMAGoiBSADBEAgA0HBAE8NAiADIABBDGoiA2ogASAEEIsBGiAAQQA2AgggBSADQQEQBCACIARrIQIgASAEaiEBCyABIAJBBnYQBCACQT9xIgNBwQBPDQIgAEEMaiABIAJBQHFqIAMQiwEaIAAgAzYCCA8LAkAgAiADaiIEIANPBEAgBEHAAEsNASAAIANqQQxqIAEgAhCLARogACAAKAIIIAJqNgIIDwsgAyAEQdCZwAAQfgALIARBwABB0JnAABB9AAsgA0HAAEHgmcAAEH4ACyADQcAAQfCZwAAQfQALqAICA38BfiMAQdAAayICJAAgASkDACEFIAJBEGogAUEMahBlIAJBCGoiAyABQdQAaikCADcDACACIAEpAkw3AwAgASgCCCEEQeAAQQgQoQEiAUUEQEHgAEEIQbSlwAAoAgAiAEECIAAbEQAAAAsgASAENgIIIAEgBTcDACABIAIpAxA3AgwgAUEUaiACQRhqKQMANwIAIAFBHGogAkEgaikDADcCACABQSRqIAJBKGopAwA3AgAgAUEsaiACQTBqKQMANwIAIAFBNGogAkE4aikDADcCACABQTxqIAJBQGspAwA3AgAgAUHEAGogAkHIAGopAwA3AgAgAUHUAGogAykDADcCACABIAIpAwA3AkwgAEG8jMAANgIEIAAgATYCACACQdAAaiQAC4gCAQN/IAAgACkDACACrXw3AwACQAJAQcAAIAAoAhwiA2siBCACTQRAIABBCGoiBSADBEAgA0HBAE8NAiADIABBIGoiA2ogASAEEIsBGiAAQQA2AhwgBSADQQEQCCACIARrIQIgASAEaiEBCyABIAJBBnYQCCACQT9xIgNBwQBPDQIgAEEgaiABIAJBQHFqIAMQiwEaIAAgAzYCHA8LAkAgAiADaiIEIANPBEAgBEHAAEsNASAAIANqQSBqIAEgAhCLARogACAAKAIcIAJqNgIcDwsgAyAEQdCZwAAQfgALIARBwABB0JnAABB9AAsgA0HAAEHgmcAAEH4ACyADQcAAQfCZwAAQfQALqAICA38BfiMAQdAAayICJAAgASkDACEFIAJBEGogAUEMahBlIAJBCGoiAyABQdQAaikCADcDACACIAEpAkw3AwAgASgCCCEEQeAAQQgQoQEiAUUEQEHgAEEIQbSlwAAoAgAiAEECIAAbEQAAAAsgASAENgIIIAEgBTcDACABIAIpAxA3AgwgAUEUaiACQRhqKQMANwIAIAFBHGogAkEgaikDADcCACABQSRqIAJBKGopAwA3AgAgAUEsaiACQTBqKQMANwIAIAFBNGogAkE4aikDADcCACABQTxqIAJBQGspAwA3AgAgAUHEAGogAkHIAGopAwA3AgAgAUHUAGogAykDADcCACABIAIpAwA3AkwgAEGokcAANgIEIAAgATYCACACQdAAaiQAC5UCAQN/IwBBEGsiBCQAIAAoAsgBIgJB5wBNBEAgACACakHMAWpBBjoAACACQQFqIgNB6ABHBEAgACADakHMAWpBAEHnACACaxCRARoLQQAhAiAAQQA2AsgBIABBswJqIgMgAy0AAEGAAXI6AAADQCAAIAJqIgMgAy0AACADQcwBai0AAHM6AAAgAkEBaiICQegARw0ACyAAEA4gASAAKQAANwAAIAFBKGogAEEoaikAADcAACABQSBqIABBIGopAAA3AAAgAUEYaiAAQRhqKQAANwAAIAFBEGogAEEQaikAADcAACABQQhqIABBCGopAAA3AAAgBEEQaiQADwtBsJrAAEEXIARBCGpByJrAAEGUnsAAEHkAC5UCAQN/IwBBEGsiBCQAIAAoAsgBIgJB5wBNBEAgACACakHMAWpBAToAACACQQFqIgNB6ABHBEAgACADakHMAWpBAEHnACACaxCRARoLQQAhAiAAQQA2AsgBIABBswJqIgMgAy0AAEGAAXI6AAADQCAAIAJqIgMgAy0AACADQcwBai0AAHM6AAAgAkEBaiICQegARw0ACyAAEA4gASAAKQAANwAAIAFBKGogAEEoaikAADcAACABQSBqIABBIGopAAA3AAAgAUEYaiAAQRhqKQAANwAAIAFBEGogAEEQaikAADcAACABQQhqIABBCGopAAA3AAAgBEEQaiQADwtBsJrAAEEXIARBCGpByJrAAEHUncAAEHkAC/MBAQR/IwBBkAFrIgIkACACQQA2AgAgAkEEciEFA0AgAyAFaiABIANqLQAAOgAAIAIgAigCAEEBaiIENgIAIANBAWoiA0HAAEcNAAsgBEE/TQRAIARBwAAQfwALIAJByABqIAJBxAAQiwEaIABBOGogAkGEAWopAgA3AAAgAEEwaiACQfwAaikCADcAACAAQShqIAJB9ABqKQIANwAAIABBIGogAkHsAGopAgA3AAAgAEEYaiACQeQAaikCADcAACAAQRBqIAJB3ABqKQIANwAAIABBCGogAkHUAGopAgA3AAAgACACKQJMNwAAIAJBkAFqJAAL9QEBA38jAEEQayIEJAAgACgCyAEiAkGHAU0EQCAAIAJqQcwBakEBOgAAIAJBAWoiA0GIAUcEQCAAIANqQcwBakEAQYcBIAJrEJEBGgtBACECIABBADYCyAEgAEHTAmoiAyADLQAAQYABcjoAAANAIAAgAmoiAyADLQAAIANBzAFqLQAAczoAACACQQFqIgJBiAFHDQALIAAQDiABIAApAAA3AAAgAUEYaiAAQRhqKQAANwAAIAFBEGogAEEQaikAADcAACABQQhqIABBCGopAAA3AAAgBEEQaiQADwtBsJrAAEEXIARBCGpByJrAAEHEncAAEHkAC/UBAQN/IwBBEGsiBCQAIAAoAsgBIgJBhwFNBEAgACACakHMAWpBBjoAACACQQFqIgNBiAFHBEAgACADakHMAWpBAEGHASACaxCRARoLQQAhAiAAQQA2AsgBIABB0wJqIgMgAy0AAEGAAXI6AAADQCAAIAJqIgMgAy0AACADQcwBai0AAHM6AAAgAkEBaiICQYgBRw0ACyAAEA4gASAAKQAANwAAIAFBGGogAEEYaikAADcAACABQRBqIABBEGopAAA3AAAgAUEIaiAAQQhqKQAANwAAIARBEGokAA8LQbCawABBFyAEQQhqQciawABBhJ7AABB5AAv1AQEDfyMAQRBrIgQkACAAKALIASICQY8BTQRAIAAgAmpBzAFqQQE6AAAgAkEBaiIDQZABRwRAIAAgA2pBzAFqQQBBjwEgAmsQkQEaC0EAIQIgAEEANgLIASAAQdsCaiIDIAMtAABBgAFyOgAAA0AgACACaiIDIAMtAAAgA0HMAWotAABzOgAAIAJBAWoiAkGQAUcNAAsgABAOIAEgACkAADcAACABQRhqIABBGGooAAA2AAAgAUEQaiAAQRBqKQAANwAAIAFBCGogAEEIaikAADcAACAEQRBqJAAPC0GwmsAAQRcgBEEIakHImsAAQdiawAAQeQAL9QEBA38jAEEQayIEJAAgACgCyAEiAkGPAU0EQCAAIAJqQcwBakEGOgAAIAJBAWoiA0GQAUcEQCAAIANqQcwBakEAQY8BIAJrEJEBGgtBACECIABBADYCyAEgAEHbAmoiAyADLQAAQYABcjoAAANAIAAgAmoiAyADLQAAIANBzAFqLQAAczoAACACQQFqIgJBkAFHDQALIAAQDiABIAApAAA3AAAgAUEYaiAAQRhqKAAANgAAIAFBEGogAEEQaikAADcAACABQQhqIABBCGopAAA3AAAgBEEQaiQADwtBsJrAAEEXIARBCGpByJrAAEH0ncAAEHkAC8MBAQJ/AkACQCAAQQRqKAIAIgMgACgCCCICayABSQRAIAEgAmoiASACSQ0BIANBAXQiAiABIAIgAUsbIgFBCCABQQhLGyICQQBIDQECQCAAKAIAQQAgAxsiAUUEQCACQQEQoQEhAQwBCyACIANGDQAgA0UEQCACQQEQoQEhAQwBCyABIANBASACEJoBIQELIAFFDQIgACABNgIAIABBBGogAjYCAAsPCxCbAQALIAJBAUG0pcAAKAIAIgBBAiAAGxEAAAALhQEBBH8jAEGgAWsiAiQAIAJBADYCACACQQRyIQUDQCADIAVqIAEgA2otAAA6AAAgAiACKAIAQQFqIgQ2AgAgA0EBaiIDQcgARw0A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JAAgAkGIAWogAUHIARCLARogAiABQcwBahBuIAEoAsgBIQNB2AJBCBChASIBRQRAQdgCQQhBtKXAACgCACIAQQIgABsRAAAACyABIAJBiAFqQcgBEIsBIgEgAzYCyAEgAUHMAWogAkGIARCLARogAEGsj8AANgIEIAAgATYCACACQdACaiQAC34BAX8jAEFAaiIFJAAgBSABNgIMIAUgADYCCCAFIAM2AhQgBSACNgIQIAVBLGpBAjYCACAFQTxqQQQ2AgAgBUICNwIcIAVB8IvAADYCGCAFQQE2AjQgBSAFQTBqNgIoIAUgBUEQajYCOCAFIAVBCGo2AjAgBUEYaiAEEJABAAuVAQAgAEIANwMIIABCADcDACAAQQA2AlAgAEGQmcAAKQMANwMQIABBGGpBmJnAACkDADcDACAAQSBqQaCZwAApAwA3AwAgAEEoakGomcAAKQMANwMAIABBMGpBsJnAACkDADcDACAAQThqQbiZwAApAwA3AwAgAEFAa0HAmcAAKQMANwMAIABByABqQciZwAApAwA3AwALlQEAIABCADcDCCAAQgA3AwAgAEEANgJQIABB0JjAACkDADcDECAAQRhqQdiYwAApAwA3AwAgAEEgakHgmMAAKQMANwMAIABBKGpB6JjAACkDADcDACAAQTBqQfCYwAApAwA3AwAgAEE4akH4mMAAKQMANwMAIABBQGtBgJnAACkDADcDACAAQcgAakGImcAAKQMANwMAC20BAX8jAEEwayIDJAAgAyABNgIEIAMgADYCACADQRxqQQI2AgAgA0EsakEFNgIAIANCAjcCDCADQYiIwAA2AgggA0EFNgIkIAMgA0EgajYCGCADIAM2AiggAyADQQRqNgIgIANBCGogAhCQAQALbQEBfyMAQTBrIgMkACADIAE2AgQgAyAANgIAIANBHGpBAjYCACADQSxqQQU2AgAgA0ICNwIMIANBpIrAADYCCCADQQU2AiQgAyADQSBqNgIYIAMgA0EEajYCKCADIAM2AiAgA0EIaiACEJABAAttAQF/IwBBMGsiAyQAIAMgATYCBCADIAA2AgAgA0EcakECNgIAIANBLGpBBTYCACADQgI3AgwgA0HcisAANgIIIANBBTYCJCADIANBIGo2AhggAyADQQRqNgIoIAMgAzYCICADQQhqIAIQkAEAC3ABAX8jAEEwayICJAAgAiABNgIEIAIgADYCACACQRxqQQI2AgAgAkEsakEFNgIAIAJCAjcCDCACQcyRwAA2AgggAkEFNgIkIAIgAkEgajYCGCACIAJBBGo2AiggAiACNgIgIAJBCGpB3JHAABCQAQALVAEBfyMAQSBrIgIkACACIAAoAgA2AgQgAkEYaiABQRBqKQIANwMAIAJBEGogAUEIaikCADcDACACIAEpAgA3AwggAkEEaiACQQhqEBYgAkEgaiQAC30BAn9BASEAQeChwABB4KHAACgCAEEBajYCAAJAAkBBqKXAACgCAEEBRwRAQailwABCgYCAgBA3AwAMAQtBrKXAAEGspcAAKAIAQQFqIgA2AgAgAEECSw0BC0GwpcAAKAIAIgFBf0wNAEGwpcAAIAE2AgAgAEEBSw0AAAsAC2ICAX8BfiMAQRBrIgIkAAJAIAEEQCABKAIADQEgAUF/NgIAIAJBCGogASgCBCABQQhqKAIAKAIQEQAAIAIpAwghAyABQQA2AgAgACADNwIAIAJBEGokAA8LEJ0BAAsQngEAC0MBA38CQCACRQ0AA0AgAC0AACIEIAEtAAAiBUYEQCAAQQFqIQAgAUEBaiEBIAJBf2oiAg0BDAILCyAEIAVrIQMLIAMLSwECfwJAIAAEQCAAKAIADQEgAEEANgIAIAAoAgQhASAAKAIIIQIgABAQIAEgAigCABEEACACKAIEBEAgARAQCw8LEJ0BAAsQngEAC0gAAkAgAARAIAAoAgANASAAQX82AgAgACgCBCABIAIgAEEIaigCACgCDBECACACBEAgARAQCyAAQQA2AgAPCxCdAQALEJ4BAAtKAAJ/IAFBgIDEAEcEQEEBIAAoAhggASAAQRxqKAIAKAIQEQEADQEaCyACRQRAQQAPCyAAKAIYIAIgAyAAQRxqKAIAKAIMEQMACwtdACAAQgA3AwAgAEEANgIwIABB0JfAACkDADcDCCAAQRBqQdiXwAApAwA3AwAgAEEYakHgl8AAKQMANwMAIABBIGpB6JfAACkDADcDACAAQShqQfCXwAApAwA3AwALSAEBfyMAQSBrIgMkACADQRRqQQA2AgAgA0HIoMAANgIQIANCATcCBCADIAE2AhwgAyAANgIYIAMgA0EYajYCACADIAIQkAEAC1AAIABBADYCCCAAQgA3AwAgAEGsmMAAKQIANwJMIABB1ABqQbSYwAApAgA3AgAgAEHcAGpBvJjAACkCADcCACAAQeQAakHEmMAAKQIANwIAC1AAIABBADYCCCAAQgA3AwAgAEGMmMAAKQIANwJMIABB1ABqQZSYwAApAgA3AgAgAEHcAGpBnJjAACkCADcCACAAQeQAakGkmMAAKQIANwIACzMBAX8gAgRAIAAhAwNAIAMgAS0AADoAACABQQFqIQEgA0EBaiEDIAJBf2oiAg0ACwsgAAs1AQJ/IAAoAgAiACACEGogAEEIaiIDKAIAIgQgACgCAGogASACEIsBGiADIAIgBGo2AgBBAAsrAAJAIABBfEsNACAARQRAQQQPCyAAIABBfUlBAnQQoQEiAEUNACAADwsACz0AIABCADcDACAAQQA2AhwgAEH4l8AAKQMANwMIIABBEGpBgJjAACkDADcDACAAQRhqQYiYwAAoAgA2AgALPQAgAEEANgIcIABCADcDACAAQRhqQYiYwAAoAgA2AgAgAEEQakGAmMAAKQMANwMAIABB+JfAACkDADcDCAtMAQF/IwBBEGsiAiQAIAIgATYCDCACIAA2AgggAkGYiMAANgIEIAJByKDAADYCACACKAIIRQRAQZ2gwABBK0HIoMAAEIgBAAsQgQEACykBAX8gAgRAIAAhAwNAIAMgAToAACADQQFqIQMgAkF/aiICDQALCyAACy4AIABBADYCCCAAQgA3AwAgAEHUAGpByJfAACkCADcCACAAQcCXwAApAgA3AkwLIAACQCABQXxLDQAgACABQQQgAhCaASIARQ0AIAAPCwALHAAgASgCGEH/h8AAQQggAUEcaigCACgCDBEDAAscACABKAIYQYKMwABBBSABQRxqKAIAKAIMEQMACxQAIAAoAgAgASAAKAIEKAIMEQEACxAAIAEgACgCACAAKAIEEBILEgAgAEEAQcgBEJEBQQA2AsgBCwsAIAEEQCAAEBALCwwAIAAgASACIAMQFwsSAEHEhsAAQRFB2IbAABCIAQALDgAgACgCABoDQAwACwALDQBB76DAAEEbEKABAAsOAEGKocAAQc8AEKABAAsLACAANQIAIAEQVQsJACAAIAEQAQALGQACfyABQQlPBEAgASAAEEYMAQsgABAJCwsNAEKtqduM/5imovgACwQAQRALBABBKAsEAEEUCwUAQcAACwQAQTALBABBHAsEAEEgCwMAAQsDAAELC+MhAQBBgIDAAAvZIW1kMgAHAAAAVAAAAAQAAAAIAAAACQAAAAoAAAALAAAADAAAAA0AAABtZDQABwAAAGAAAAAIAAAADgAAAA8AAAAQAAAAEQAAABIAAAATAAAAbWQ1AAcAAABgAAAACAAAABQAAAAVAAAAFgAAABEAAAASAAAAFwAAAHJpcGVtZDE2MAAAAAcAAABgAAAACAAAABgAAAAZAAAAGgAAABsAAAAcAAAAHQAAAHJpcGVtZDMyMAAAAAcAAAB4AAAACAAAAB4AAAAfAAAAIAAAACEAAAAiAAAAIwAAAHNoYTEHAAAAYAAAAAgAAAAkAAAAJQAAACYAAAAnAAAAHAAAACgAAABzaGEyMjQAAAcAAABwAAAACAAAACkAAAAqAAAAKwAAACwAAAAtAAAALgAAAHNoYTI1NgAABwAAAHAAAAAIAAAAKQAAAC8AAAAwAAAAMQAAADIAAAAzAAAAc2hhMzg0AAAHAAAA2AAAAAgAAAA0AAAANQAAADYAAAA3AAAAOAAAADkAAABzaGE1MTIAAAcAAADYAAAACAAAADQAAAA6AAAAOwAAADwAAAA9AAAAPgAAAHNoYTMtMjI0BwAAAGABAAAIAAAAPwAAAEAAAABBAAAAQgAAAEMAAABEAAAAc2hhMy0yNTYHAAAAWAEAAAgAAABFAAAARgAAAEcAAABIAAAASQAAAEoAAABzaGEzLTM4NAcAAAA4AQAACAAAAEsAAABMAAAATQAAAE4AAABPAAAAUAAAAHNoYTMtNTEyBwAAABgBAAAIAAAAUQAAAFIAAABTAAAAVAAAAFUAAABWAAAAa2VjY2FrMjI0AAAABwAAAGABAAAIAAAAPwAAAFcAAABYAAAAQgAAAEMAAABZAAAAa2VjY2FrMjU2AAAABwAAAFgBAAAIAAAARQAAAFoAAABbAAAASAAAAEkAAABcAAAAa2VjY2FrMzg0AAAABwAAADgBAAAIAAAASwAAAF0AAABeAAAATgAAAE8AAABfAAAAa2VjY2FrNTEyAAAABwAAABgBAAAIAAAAUQAAAGAAAABhAAAAVAAAAFUAAABiAAAAdW5zdXBwb3J0ZWQgaGFzaCBhbGdvcml0aG06ICADEAAcAAAAY2FwYWNpdHkgb3ZlcmZsb3cAAABoAxAAFwAAABcCAAAFAAAAc3JjL2xpYmFsbG9jL3Jhd192ZWMucnMABwAAAAQAAAAEAAAAYwAAAGQAAABlAAAAYSBmb3JtYXR0aW5nIHRyYWl0IGltcGxlbWVudGF0aW9uIHJldHVybmVkIGFuIGVycm9yAAcAAAAAAAAAAQAAAGYAAADsAxAAEwAAAEoCAAAcAAAAc3JjL2xpYmFsbG9jL2ZtdC5yc1BhZEVycm9yACgEEAAgAAAASAQQABIAAAAHAAAAAAAAAAEAAABnAAAAaW5kZXggb3V0IG9mIGJvdW5kczogdGhlIGxlbiBpcyAgYnV0IHRoZSBpbmRleCBpcyAwMDAxMDIwMzA0MDUwNjA3MDgwOTEwMTExMjEzMTQxNTE2MTcxODE5MjAyMTIyMjMyNDI1MjYyNzI4MjkzMDMxMzIzMzM0MzUzNjM3MzgzOTQwNDE0MjQzNDQ0NTQ2NDc0ODQ5NTA1MTUyNTM1NDU1NTY1NzU4NTk2MDYxNjI2MzY0NjU2NjY3Njg2OTcwNzE3MjczNzQ3NTc2Nzc3ODc5ODA4MTgyODM4NDg1ODY4Nzg4ODk5MDkxOTI5Mzk0OTU5Njk3OTg5OQAANAUQAAYAAAA6BRAAIgAAAGluZGV4ICBvdXQgb2YgcmFuZ2UgZm9yIHNsaWNlIG9mIGxlbmd0aCBsBRAAFgAAAIIFEAANAAAAc2xpY2UgaW5kZXggc3RhcnRzIGF0ICBidXQgZW5kcyBhdCAAsAUQABYAAABdBAAAJAAAALAFEAAWAAAAUwQAABEAAABzcmMvbGliY29yZS9mbXQvbW9kLnJzAADaBRAAFgAAAFQAAAAUAAAAMHhzcmMvbGliY29yZS9mbXQvbnVtLnJzSBAQAAAAAAAABhAAAgAAADogRXJyb3JUcmllZCB0byBzaHJpbmsgdG8gYSBsYXJnZXIgY2FwYWNpdHkAcA8QAHQAAAAKAAAACQAAAAcAAABgAAAACAAAAA4AAAAPAAAAEAAAABEAAAASAAAAEwAAAAcAAAB4AAAACAAAAB4AAAAfAAAAIAAAACEAAAAiAAAAIwAAAAcAAABgAAAACAAAABgAAAAZAAAAGgAAABsAAAAcAAAAHQAAABAAAABAAAAABwAAAGAAAAAIAAAAJAAAACUAAAAmAAAAJwAAABwAAAAoAAAABwAAABgBAAAIAAAAUQAAAGAAAABhAAAAVAAAAFUAAABiAAAABwAAADgBAAAIAAAASwAAAEwAAABNAAAATgAAAE8AAABQAAAABwAAAGABAAAIAAAAPwAAAFcAAABYAAAAQgAAAEMAAABZAAAABwAAAFgBAAAIAAAARQAAAEYAAABHAAAASAAAAEkAAABKAAAABwAAADgBAAAIAAAASwAAAF0AAABeAAAATgAAAE8AAABfAAAABwAAABgBAAAIAAAAUQAAAFIAAABTAAAAVAAAAFUAAABWAAAABwAAAFgBAAAIAAAARQAAAFoAAABbAAAASAAAAEkAAABcAAAABwAAAGABAAAIAAAAPwAAAEAAAABBAAAAQgAAAEMAAABEAAAABwAAAFQAAAAEAAAACAAAAAkAAAAKAAAACwAAAAwAAAANAAAABwAAANgAAAAIAAAANAAAADoAAAA7AAAAPAAAAD0AAAA+AAAABwAAANgAAAAIAAAANAAAADUAAAA2AAAANwAAADgAAAA5AAAABwAAAHAAAAAIAAAAKQAAACoAAAArAAAALAAAAC0AAAAuAAAABwAAAHAAAAAIAAAAKQAAAC8AAAAwAAAAMQAAADIAAAAzAAAABwAAAGAAAAAIAAAAFAAAABUAAAAWAAAAEQAAABIAAAAXAAAATgkQACEAAABvCRAAFwAAAOwIEABiAAAAZwEAAAUAAAAvaG9tZS9sdWNhY2Fzb25hdG8vLmNhcmdvL3JlZ2lzdHJ5L3NyYy9naXRodWIuY29tLTFlY2M2Mjk5ZGI5ZWM4MjMvZ2VuZXJpYy1hcnJheS0wLjE0LjQvc3JjL2xpYi5yc0dlbmVyaWNBcnJheTo6ZnJvbV9pdGVyIHJlY2VpdmVkICBlbGVtZW50cyBidXQgZXhwZWN0ZWQgAAABAAAAAAAAAIKAAAAAAAAAioAAAAAAAIAAgACAAAAAgIuAAAAAAAAAAQAAgAAAAACBgACAAAAAgAmAAAAAAACAigAAAAAAAACIAAAAAAAAAAmAAIAAAAAACgAAgAAAAACLgACAAAAAAIsAAAAAAACAiYAAAAAAAIADgAAAAAAAgAKAAAAAAACAgAAAAAAAAIAKgAAAAAAAAAoAAIAAAACAgYAAgAAAAICAgAAAAAAAgAEAAIAAAAAACIAAgAAAAIApLkPJoth8AT02VKHs8AYTYqcF88DHc4yYkyvZvEyCyh6bVzz91OAWZ0JvGIoX5RK+TsTW2p7eSaD79Y67L+56qWh5kRWyBz+UwhCJCyJfIYB/XZpakDInNT7M57/3lwP/GTCzSKW10ddekiqsVqrGT7g40pakfbZ2/GvinHQE8UWdcFlkcYcghlvPZeYtqAIbYCWtrrC59hxGYWk0QH4PVUejI91RrzrDXPnOusXqJixTDW6FKIQJ09/N9EGBTVJq3DfIbMGr+iThewgMvbFKeIiVi+Nj6G3py9X+OwAdOfLvtw5mWNDkpndy+Ot1SwoxRFC0j+0fGtuZjTOfEYMUL2hvbWUvbHVjYWNhc29uYXRvLy5jYXJnby9yZWdpc3RyeS9zcmMvZ2l0aHViLmNvbS0xZWNjNjI5OWRiOWVjODIzL21kMi0wLjkuMC9zcmMvbGliLnJzAAcAAAAAAAAAAQAAAGgAAABICxAAVwAAAG8AAAAOAAAAASNFZ4mrze/+3LqYdlQyEAEjRWeJq83v/ty6mHZUMhDw4dLDEDJUdpi63P7vzauJZ0UjAQ8eLTwBI0VniavN7/7cuph2VDIQ8OHSw9ieBcEH1Xw2F91wMDlZDvcxC8D/ERVYaKeP+WSkT/q+Z+YJaoWuZ7ty8248OvVPpX9SDlGMaAWbq9mDHxnN4FsAAAAA2J4FwV2du8sH1Xw2KimaYhfdcDBaAVmROVkO99jsLxUxC8D/ZyYzZxEVWGiHSrSOp4/5ZA0uDNukT/q+HUi1RwjJvPNn5glqO6fKhIWuZ7sr+JT+cvNuPPE2HV869U+l0YLmrX9SDlEfbD4rjGgFm2u9Qfur2YMfeSF+ExnN4FvwDRAAYAAAADoAAAANAAAA8A0QAGAAAABBAAAADQAAAPANEABgAAAAVQAAAAkAAADwDRAAYAAAAIcAAAAXAAAA8A0QAGAAAACLAAAAGwAAAPANEABgAAAAhAAAAAkAAAB3ZSBuZXZlciB1c2UgaW5wdXRfbGF6eQAHAAAAAAAAAAEAAABoAAAAaA0QAFgAAABBAAAAAQAAAC9ob21lL2x1Y2FjYXNvbmF0by8uY2FyZ28vcmVnaXN0cnkvc3JjL2dpdGh1Yi5jb20tMWVjYzYyOTlkYjllYzgyMy9zaGEzLTAuOS4xL3NyYy9saWIucnPwDRAAYAAAABsAAAANAAAA8A0QAGAAAAAiAAAADQAAAFAOEABzAAAACgQAAAsAAAAvaG9tZS9sdWNhY2Fzb25hdG8vLmNhcmdvL3JlZ2lzdHJ5L3NyYy9naXRodWIuY29tLTFlY2M2Mjk5ZGI5ZWM4MjMvYmxvY2stYnVmZmVyLTAuOS4wL3NyYy9saWIucnMvaG9tZS9sdWNhY2Fzb25hdG8vLnJ1c3R1cC90b29sY2hhaW5zL3N0YWJsZS14ODZfNjQtdW5rbm93bi1saW51eC1nbnUvbGliL3J1c3RsaWIvc3JjL3J1c3Qvc3JjL2xpYmNvcmUvc2xpY2UvbW9kLnJzAGgNEABYAAAASAAAAAEAAABoDRAAWAAAAE8AAAABAAAAaA0QAFgAAABWAAAAAQAAAGgNEABYAAAAZgAAAAEAAABoDRAAWAAAAG0AAAABAAAAaA0QAFgAAAB0AAAAAQAAAGgNEABYAAAAewAAAAEAAACQAAAA5A8QAC0AAAAREBAADAAAAFAPEAABAAAAYAAAAIgAAABoAAAASAAAAHAPEAB0AAAAEAAAAAkAAAAvaG9tZS9sdWNhY2Fzb25hdG8vLnJ1c3R1cC90b29sY2hhaW5zL3N0YWJsZS14ODZfNjQtdW5rbm93bi1saW51eC1nbnUvbGliL3J1c3RsaWIvc3JjL3J1c3Qvc3JjL2xpYmNvcmUvbWFjcm9zL21vZC5yc2Fzc2VydGlvbiBmYWlsZWQ6IGAobGVmdCA9PSByaWdodClgCiAgbGVmdDogYGAsCiByaWdodDogYGNhbGxlZCBgT3B0aW9uOjp1bndyYXAoKWAgb24gYSBgTm9uZWAgdmFsdWVYEBAAFwAAALQBAAAeAAAAc3JjL2xpYnN0ZC9wYW5pY2tpbmcucnNudWxsIHBvaW50ZXIgcGFzc2VkIHRvIHJ1c3RyZWN1cnNpdmUgdXNlIG9mIGFuIG9iamVjdCBkZXRlY3RlZCB3aGljaCB3b3VsZCBsZWFkIHRvIHVuc2FmZSBhbGlhc2luZyBpbiBydXN0AHsJcHJvZHVjZXJzAghsYW5ndWFnZQEEUnVzdAAMcHJvY2Vzc2VkLWJ5AwVydXN0Yx0xLjQ2LjAgKDA0NDg4YWZlMyAyMDIwLTA4LTI0KQZ3YWxydXMGMC4xOC4wDHdhc20tYmluZGdlbhIwLjIuNjggKGEwNGUxODk3MSk=");
let wasm;
let cachedTextDecoder = new TextDecoder("utf-8", {
    ignoreBOM: true,
    fatal: true
});
cachedTextDecoder.decode();
let cachegetUint8Memory0 = null;
function getUint8Memory0() {
    if (cachegetUint8Memory0 === null || cachegetUint8Memory0.buffer !== wasm.memory.buffer) {
        cachegetUint8Memory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachegetUint8Memory0;
}
function getStringFromWasm0(ptr, len) {
    return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len));
}
const heap = new Array(32).fill(undefined);
heap.push(undefined, null, true, false);
let heap_next = heap.length;
function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];
    heap[idx] = obj;
    return idx;
}
function getObject(idx) {
    return heap[idx];
}
function dropObject(idx) {
    if (idx < 36) return;
    heap[idx] = heap_next;
    heap_next = idx;
}
function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}
let WASM_VECTOR_LEN = 0;
let cachedTextEncoder = new TextEncoder("utf-8");
const encodeString = typeof cachedTextEncoder.encodeInto === "function" ? function(arg, view) {
    return cachedTextEncoder.encodeInto(arg, view);
} : function(arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
        read: arg.length,
        written: buf.length
    };
};
function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length);
        getUint8Memory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }
    let len = arg.length;
    let ptr = malloc(len);
    const mem = getUint8Memory0();
    let offset = 0;
    for(; offset < len; offset++){
        const code = arg.charCodeAt(offset);
        if (code > 127) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3);
        const view = getUint8Memory0().subarray(ptr + offset, ptr + len);
        const ret = encodeString(arg, view);
        offset += ret.written;
    }
    WASM_VECTOR_LEN = offset;
    return ptr;
}
function create_hash(algorithm) {
    var ptr0 = passStringToWasm0(algorithm, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ret = wasm.create_hash(ptr0, len0);
    return DenoHash.__wrap(ret);
}
function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
    return instance.ptr;
}
function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1);
    getUint8Memory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}
function update_hash(hash, data) {
    _assertClass(hash, DenoHash);
    var ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    wasm.update_hash(hash.ptr, ptr0, len0);
}
let cachegetInt32Memory0 = null;
function getInt32Memory0() {
    if (cachegetInt32Memory0 === null || cachegetInt32Memory0.buffer !== wasm.memory.buffer) {
        cachegetInt32Memory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachegetInt32Memory0;
}
function getArrayU8FromWasm0(ptr, len) {
    return getUint8Memory0().subarray(ptr / 1, ptr / 1 + len);
}
function digest_hash(hash) {
    try {
        const retptr = wasm.__wbindgen_export_2.value - 16;
        wasm.__wbindgen_export_2.value = retptr;
        _assertClass(hash, DenoHash);
        wasm.digest_hash(retptr, hash.ptr);
        var r0 = getInt32Memory0()[retptr / 4 + 0];
        var r11 = getInt32Memory0()[retptr / 4 + 1];
        var v0 = getArrayU8FromWasm0(r0, r11).slice();
        wasm.__wbindgen_free(r0, r11 * 1);
        return v0;
    } finally{
        wasm.__wbindgen_export_2.value += 16;
    }
}
class DenoHash {
    static __wrap(ptr) {
        const obj = Object.create(DenoHash.prototype);
        obj.ptr = ptr;
        return obj;
    }
    free() {
        const ptr = this.ptr;
        this.ptr = 0;
        wasm.__wbg_denohash_free(ptr);
    }
}
async function load(module, imports) {
    if (typeof Response === "function" && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === "function") {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                if (module.headers.get("Content-Type") != "application/wasm") {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
                } else {
                    throw e;
                }
            }
        }
        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);
        if (instance instanceof WebAssembly.Instance) {
            return {
                instance,
                module
            };
        } else {
            return instance;
        }
    }
}
async function init1(input) {
    if (typeof input === "undefined") {
        input = importMeta1.url.replace(/\.js$/, "_bg.wasm");
    }
    const imports = {
    };
    imports.wbg = {
    };
    imports.wbg.__wbindgen_string_new = function(arg0, arg1) {
        var ret = getStringFromWasm0(arg0, arg1);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_throw = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbindgen_rethrow = function(arg0) {
        throw takeObject(arg0);
    };
    if (typeof input === "string" || typeof Request === "function" && input instanceof Request || typeof URL === "function" && input instanceof URL) {
        input = fetch(input);
    }
    const { instance , module  } = await load(await input, imports);
    wasm = instance.exports;
    init1.__wbindgen_wasm_module = module;
    return wasm;
}
const hexTable = new TextEncoder().encode("0123456789abcdef");
function encodedLen(n) {
    return n * 2;
}
function encode1(src) {
    const dst = new Uint8Array(encodedLen(src.length));
    for(let i = 0; i < dst.length; i++){
        const v = src[i];
        dst[i * 2] = hexTable[v >> 4];
        dst[i * 2 + 1] = hexTable[v & 15];
    }
    return dst;
}
function encodeToString(src) {
    return new TextDecoder().decode(encode1(src));
}
await init1(source1);
const TYPE_ERROR_MSG = "hash: `data` is invalid type";
class Hash {
    #hash;
    #digested;
    constructor(algorithm){
        this.#hash = create_hash(algorithm);
        this.#digested = false;
    }
    update(data) {
        let msg;
        if (typeof data === "string") {
            msg = new TextEncoder().encode(data);
        } else if (typeof data === "object") {
            if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
                msg = new Uint8Array(data);
            } else {
                throw new Error(TYPE_ERROR_MSG);
            }
        } else {
            throw new Error(TYPE_ERROR_MSG);
        }
        update_hash(this.#hash, msg);
        return this;
    }
    digest() {
        if (this.#digested) throw new Error("hash: already digested");
        this.#digested = true;
        return digest_hash(this.#hash);
    }
    toString(format = "hex") {
        const finalized = new Uint8Array(this.digest());
        switch(format){
            case "hex":
                return encodeToString(finalized);
            case "base64":
                return encode(finalized);
            default:
                throw new Error("hash: invalid format");
        }
    }
}
function createHash(algorithm1) {
    return new Hash(algorithm1);
}
async function computeHash(path1) {
    const handle = await Deno.open(path1);
    const hash = createHash('sha256');
    for await (const chunk of iter(handle)){
        hash.update(chunk);
    }
    handle.close();
    return hash.toString();
}
function pickFromArray(arr) {
    if (!arr.length) {
        throw new Error('Given array is empty.');
    }
    return arr[random(0, arr.length - 1)];
}
function random(min, max) {
    const range = max - min + 1;
    const bytesNeeded = Math.ceil(Math.log2(range) / 8);
    const cutoff = Math.floor(256 ** bytesNeeded / range) * range;
    const bytes = new Uint8Array(bytesNeeded);
    let value;
    do {
        crypto.getRandomValues(bytes);
        value = bytes.reduce((acc, x, n)=>acc + x * 256 ** n
        , 0);
    }while (value >= cutoff)
    return min + value % range;
}
const imageList = [];
for await (const { path: path1  } of walk(config.image.repository, {
    maxDepth: 2,
    exts: config.image.extensions
})){
    const { dir  } = parse2(relative2(config.image.repository, path1));
    imageList.push({
        category: dir.toLowerCase(),
        path: path1,
        hash: await computeHash(path1)
    });
}
function parse4(url) {
    const rawParams = url.split('/').map((part)=>part.trim().toLowerCase()
    ).filter((part)=>part !== ''
    );
    const { sizeLimit , defaultSize  } = config.image;
    const params = {
    };
    for (const rawParam of rawParams){
        const parsed = parseInt(rawParam);
        if (isNaN(parsed)) {
            if (params.category) {
                throw new Error(`Invalid parameter: ${rawParam}`);
            }
            params.category = rawParam;
        } else if (parsed < 1 || parsed > sizeLimit) {
            throw new Error(`Image size out of valid range (1-${sizeLimit}): ${parsed}`);
        } else if (params.width && params.height) {
            throw new Error('Width and height already specified!');
        } else if (params.width) {
            params.height = parsed;
        } else {
            params.width = parsed;
        }
    }
    if (!params.width) {
        params.width = defaultSize;
    }
    if (!params.height) {
        params.height = params.width;
    }
    if (params.category && !imageList.find((image)=>image.category === params.category
    )) {
        params.category = undefined;
    }
    return params;
}
const table = new Uint32Array([
    0,
    1996959894,
    3993919788,
    2567524794,
    124634137,
    1886057615,
    3915621685,
    2657392035,
    249268274,
    2044508324,
    3772115230,
    2547177864,
    162941995,
    2125561021,
    3887607047,
    2428444049,
    498536548,
    1789927666,
    4089016648,
    2227061214,
    450548861,
    1843258603,
    4107580753,
    2211677639,
    325883990,
    1684777152,
    4251122042,
    2321926636,
    335633487,
    1661365465,
    4195302755,
    2366115317,
    997073096,
    1281953886,
    3579855332,
    2724688242,
    1006888145,
    1258607687,
    3524101629,
    2768942443,
    901097722,
    1119000684,
    3686517206,
    2898065728,
    853044451,
    1172266101,
    3705015759,
    2882616665,
    651767980,
    1373503546,
    3369554304,
    3218104598,
    565507253,
    1454621731,
    3485111705,
    3099436303,
    671266974,
    1594198024,
    3322730930,
    2970347812,
    795835527,
    1483230225,
    3244367275,
    3060149565,
    1994146192,
    31158534,
    2563907772,
    4023717930,
    1907459465,
    112637215,
    2680153253,
    3904427059,
    2013776290,
    251722036,
    2517215374,
    3775830040,
    2137656763,
    141376813,
    2439277719,
    3865271297,
    1802195444,
    476864866,
    2238001368,
    4066508878,
    1812370925,
    453092731,
    2181625025,
    4111451223,
    1706088902,
    314042704,
    2344532202,
    4240017532,
    1658658271,
    366619977,
    2362670323,
    4224994405,
    1303535960,
    984961486,
    2747007092,
    3569037538,
    1256170817,
    1037604311,
    2765210733,
    3554079995,
    1131014506,
    879679996,
    2909243462,
    3663771856,
    1141124467,
    855842277,
    2852801631,
    3708648649,
    1342533948,
    654459306,
    3188396048,
    3373015174,
    1466479909,
    544179635,
    3110523913,
    3462522015,
    1591671054,
    702138776,
    2966460450,
    3352799412,
    1504918807,
    783551873,
    3082640443,
    3233442989,
    3988292384,
    2596254646,
    62317068,
    1957810842,
    3939845945,
    2647816111,
    81470997,
    1943803523,
    3814918930,
    2489596804,
    225274430,
    2053790376,
    3826175755,
    2466906013,
    167816743,
    2097651377,
    4027552580,
    2265490386,
    503444072,
    1762050814,
    4150417245,
    2154129355,
    426522225,
    1852507879,
    4275313526,
    2312317920,
    282753626,
    1742555852,
    4189708143,
    2394877945,
    397917763,
    1622183637,
    3604390888,
    2714866558,
    953729732,
    1340076626,
    3518719985,
    2797360999,
    1068828381,
    1219638859,
    3624741850,
    2936675148,
    906185462,
    1090812512,
    3747672003,
    2825379669,
    829329135,
    1181335161,
    3412177804,
    3160834842,
    628085408,
    1382605366,
    3423369109,
    3138078467,
    570562233,
    1426400815,
    3317316542,
    2998733608,
    733239954,
    1555261956,
    3268935591,
    3050360625,
    752459403,
    1541320221,
    2607071920,
    3965973030,
    1969922972,
    40735498,
    2617837225,
    3943577151,
    1913087877,
    83908371,
    2512341634,
    3803740692,
    2075208622,
    213261112,
    2463272603,
    3855990285,
    2094854071,
    198958881,
    2262029012,
    4057260610,
    1759359992,
    534414190,
    2176718541,
    4139329115,
    1873836001,
    414664567,
    2282248934,
    4279200368,
    1711684554,
    285281116,
    2405801727,
    4167216745,
    1634467795,
    376229701,
    2685067896,
    3608007406,
    1308918612,
    956543938,
    2808555105,
    3495958263,
    1231636301,
    1047427035,
    2932959818,
    3654703836,
    1088359270,
    936918000,
    2847714899,
    3736837829,
    1202900863,
    817233897,
    3183342108,
    3401237130,
    1404277552,
    615818150,
    3134207493,
    3453421203,
    1423857449,
    601450431,
    3009837614,
    3294710456,
    1567103746,
    711928724,
    3020668471,
    3272380065,
    1510334235,
    755167117
]);
function crc32(buffer) {
    let offset = 0;
    let crc = 4294967295;
    while(offset < buffer.length - 4){
        crc = table[(crc ^ buffer[offset++]) & 255] ^ crc >>> 8;
        crc = table[(crc ^ buffer[offset++]) & 255] ^ crc >>> 8;
        crc = table[(crc ^ buffer[offset++]) & 255] ^ crc >>> 8;
        crc = table[(crc ^ buffer[offset++]) & 255] ^ crc >>> 8;
    }
    while(offset < buffer.length){
        crc = table[(crc ^ buffer[offset++]) & 255] ^ crc >>> 8;
    }
    return (crc ^ 4294967295) >>> 0;
}
class Buffer1 {
    static concat(...arrays) {
        const array = new Uint8Array(arrays.reduce((length, array1)=>length + array1.length
        , 0));
        let offset = 0;
        for (const x of arrays){
            array.set(x, offset);
            offset += x.length;
        }
        return array;
    }
}
const importMeta2 = {
    url: "https://deno.land/x/imagescript@1.2.7/utils/wasm/zlib.js",
    main: false
};
let wasm1;
{
    const path2 = new URL(importMeta2.url.replace('.js', '.wasm'));
    const module = new WebAssembly.Module(await ('file:' === path2.protocol ? Deno.readFile(path2) : fetch(path2).then((r2)=>r2.arrayBuffer()
    )));
    const instance = new WebAssembly.Instance(module);
    wasm1 = instance.exports;
}class mem4 {
    static length() {
        return wasm1.wlen();
    }
    static alloc(size) {
        return wasm1.walloc(size);
    }
    static free(ptr, size) {
        return wasm1.wfree(ptr, size);
    }
    static u8(ptr, size) {
        return new Uint8Array(wasm1.memory.buffer, ptr, size);
    }
    static u32(ptr, size) {
        return new Uint32Array(wasm1.memory.buffer, ptr, size);
    }
    static copy_and_free(ptr, size) {
        let slice = mem4.u8(ptr, size).slice();
        return wasm1.wfree(ptr, size), slice;
    }
}
function compress(buffer, level = 3) {
    const ptr = mem4.alloc(buffer.length);
    mem4.u8(ptr, buffer.length).set(buffer);
    return mem4.copy_and_free(wasm1.compress(ptr, buffer.length, level), mem4.length());
}
function decompress(buffer, limit = 0) {
    const ptr = mem4.alloc(buffer.length);
    mem4.u8(ptr, buffer.length).set(buffer);
    const x = wasm1.decompress(ptr, buffer.length, limit);
    if (0 === x) throw new Error('zlib: failed to decompress');
    return mem4.copy_and_free(x, mem4.length());
}
const __IHDR__ = new Uint8Array([
    73,
    72,
    68,
    82
]);
const __IDAT__ = new Uint8Array([
    73,
    68,
    65,
    84
]);
const __IEND__ = new Uint8Array([
    73,
    69,
    78,
    68
]);
const __IEND_CRC__ = crc32(new Uint8Array([
    73,
    69,
    78,
    68
]));
const HEAD = new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10
]);
const color_types = {
    GREYSCALE: 0,
    TRUECOLOR: 2,
    INDEXED_COLOR: 3,
    GREYSCALE_ALPHA: 4,
    TRUECOLOR_ALPHA: 6
};
const channels_to_color_type = {
    1: color_types.GREYSCALE,
    2: color_types.GREYSCALE_ALPHA,
    3: color_types.TRUECOLOR,
    4: color_types.TRUECOLOR_ALPHA
};
async function encode2(data, { width , height , channels , depth =8 , level =0  }) {
    let offset = 0;
    let tmp_offset = 0;
    const row_length = width * channels;
    const tmp = new Uint8Array(height + data.length);
    while(offset < data.length){
        tmp[tmp_offset++] = 0;
        tmp.set(data.subarray(offset, offset += row_length), tmp_offset);
        tmp_offset += row_length;
    }
    const compressed = await compress(tmp, level);
    const array = new Uint8Array(49 + HEAD.length + compressed.length);
    array[26] = 0;
    array[27] = 0;
    array[28] = 0;
    array[24] = depth;
    array.set(HEAD, 0);
    array.set(__IHDR__, 12);
    array.set(__IDAT__, 37);
    array.set(compressed, 41);
    array.set(__IEND__, 49 + compressed.length);
    array[25] = channels_to_color_type[channels];
    const view = new DataView(array.buffer);
    view.setUint32(8, 13);
    view.setUint32(16, width);
    view.setUint32(20, height);
    view.setUint32(33, compressed.length);
    view.setUint32(45 + compressed.length, 0);
    view.setUint32(53 + compressed.length, __IEND_CRC__);
    view.setUint32(29, crc32(new Uint8Array(array.buffer, 12, 17)));
    view.setUint32(41 + compressed.length, crc32(new Uint8Array(array.buffer, 37, 4 + compressed.length)));
    return array;
}
async function decode1(array) {
    let view = new DataView(array.buffer, array.byteOffset, array.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    const bpc = array[24];
    const pixel_type = array[25];
    let channels = {
        3: 1,
        0: 1,
        4: 2,
        2: 3,
        6: 4
    }[pixel_type];
    const bytespp = channels * bpc / 8;
    const row_length = width * bytespp;
    let pixels = new Uint8Array(height * row_length);
    let offset = 0;
    let p_offset = 0;
    let c_offset = 33;
    const chunks = [];
    let palette, alphaPalette;
    let type;
    while(type !== 1229278788){
        type = view.getUint32(4 + c_offset);
        if (type === 1229209940) chunks.push(array.subarray(8 + c_offset, 8 + c_offset + view.getUint32(c_offset)));
        else if (type === 1347179589) {
            if (palette) throw new Error('PLTE can only occur once in an image');
            palette = new Uint32Array(view.getUint32(c_offset));
            for(let pxlOffset = 0; pxlOffset < palette.length * 8; pxlOffset += 3)palette[pxlOffset / 3] = array[8 + c_offset + pxlOffset] << 24 | array[8 + c_offset + pxlOffset + 1] << 16 | array[8 + c_offset + pxlOffset + 2] << 8 | 255;
        } else if (type === 1951551059) {
            if (alphaPalette) throw new Error('tRNS can only occur once in an image');
            alphaPalette = new Uint8Array(view.getUint32(c_offset));
            for(let i = 0; i < alphaPalette.length; i++)alphaPalette[i] = array[8 + c_offset + i];
        }
        c_offset += 4 + 4 + 4 + view.getUint32(c_offset);
    }
    array = await decompress(chunks.length === 1 ? chunks[0] : Buffer1.concat(...chunks));
    while(offset < array.byteLength){
        const filter = array[offset++];
        const slice = array.subarray(offset, offset += row_length);
        if (0 === filter) pixels.set(slice, p_offset);
        else if (1 === filter) filter_1(slice, pixels, p_offset, bytespp, row_length);
        else if (2 === filter) filter_2(slice, pixels, p_offset, bytespp, row_length);
        else if (3 === filter) filter_3(slice, pixels, p_offset, bytespp, row_length);
        else if (4 === filter) filter_4(slice, pixels, p_offset, bytespp, row_length);
        p_offset += row_length;
    }
    if (pixel_type === 3) {
        if (!palette) throw new Error('Indexed color PNG has no PLTE');
        if (alphaPalette) for(let i = 0; i < alphaPalette.length; i++)palette[i] &= 4294967040 | alphaPalette[i];
        channels = 4;
        const newPixels = new Uint8Array(width * height * 4);
        const pixelView = new DataView(newPixels.buffer, newPixels.byteOffset, newPixels.byteLength);
        for(let i1 = 0; i1 < pixels.length; i1++)pixelView.setUint32(i1 * 4, palette[pixels[i1]], false);
        pixels = newPixels;
    }
    if (bpc !== 8) {
        const newPixels = new Uint8Array(pixels.length / bpc * 8);
        for(let i = 0; i < pixels.length; i += 2)newPixels[i / 2] = pixels[i];
        pixels = newPixels;
    }
    if (channels !== 4) {
        const newPixels = new Uint8Array(width * height * 4);
        const view1 = new DataView(newPixels.buffer);
        if (channels === 1) {
            for(let i = 0; i < width * height; i++){
                const pixel = pixels[i];
                view1.setUint32(i * 4, pixel << 24 | pixel << 16 | pixel << 8 | 255, false);
            }
        } else if (channels === 2) {
            for(let i = 0; i < width * height * 2; i += 2){
                const pixel = pixels[i];
                view1.setUint32(i * 2, pixel << 24 | pixel << 16 | pixel << 8 | pixels[i + 1], false);
            }
        } else if (channels === 3) {
            newPixels.fill(255);
            for(let i = 0; i < width * height; i++)newPixels.set(pixels.subarray(i * 3, i * 3 + 3), i * 4);
        }
        pixels = newPixels;
    }
    return {
        width,
        height,
        pixels
    };
}
function filter_1(slice, pixels, p_offset, bytespp, row_length) {
    let i = 0;
    while(i < bytespp)pixels[i + p_offset] = slice[i++];
    while(i < row_length)pixels[i + p_offset] = slice[i] + pixels[(i++) + p_offset - bytespp];
}
function filter_2(slice, pixels, p_offset, bytespp, row_length) {
    if (0 === p_offset) pixels.set(slice, p_offset);
    else {
        let i = 0;
        while(i < row_length)pixels[i + p_offset] = slice[i] + pixels[(i++) + p_offset - row_length];
    }
}
function filter_3(slice, pixels, p_offset, bytespp, row_length) {
    let i = 0;
    if (0 === p_offset) {
        while(i < bytespp)pixels[i] = slice[i++];
        while(i < row_length)pixels[i] = slice[i] + (pixels[(i++) - bytespp] >> 1);
    } else {
        while(i < bytespp)pixels[i + p_offset] = slice[i] + (pixels[(i++) + p_offset - row_length] >> 1);
        while(i < row_length)pixels[i + p_offset] = slice[i] + (pixels[i + p_offset - bytespp] + pixels[(i++) + p_offset - row_length] >> 1);
    }
}
function filter_4(slice, pixels, p_offset, bytespp, row_length) {
    let i = 0;
    if (0 === p_offset) {
        while(i < bytespp)pixels[i] = slice[i++];
        while(i < row_length)pixels[i] = slice[i] + pixels[(i++) - bytespp];
    } else {
        while(i < bytespp)pixels[i + p_offset] = slice[i] + pixels[(i++) + p_offset - row_length];
        while(i < row_length){
            const a = pixels[i + p_offset - bytespp];
            const b = pixels[i + p_offset - row_length];
            const c = pixels[i + p_offset - bytespp - row_length];
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            pixels[i + p_offset] = slice[i++] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
    }
}
const importMeta3 = {
    url: "https://deno.land/x/imagescript@1.2.7/utils/wasm/font.js",
    main: false
};
let wasm2;
let registry = null;
{
    const path2 = new URL(importMeta3.url.replace('.js', '.wasm'));
    const module = new WebAssembly.Module(await ('file:' === path2.protocol ? Deno.readFile(path2) : fetch(path2).then((r2)=>r2.arrayBuffer()
    )));
    const instance = new WebAssembly.Instance(module);
    wasm2 = instance.exports;
}class mem1 {
    static length() {
        return wasm2.wlen();
    }
    static alloc(size) {
        return wasm2.walloc(size);
    }
    static free(ptr, size) {
        return wasm2.wfree(ptr, size);
    }
    static u8(ptr, size) {
        return new Uint8Array(wasm2.memory.buffer, ptr, size);
    }
    static u32(ptr, size) {
        return new Uint32Array(wasm2.memory.buffer, ptr, size);
    }
    static copy_and_free(ptr, size) {
        let slice = mem1.u8(ptr, size).slice();
        return wasm2.wfree(ptr, size), slice;
    }
}
const encode_utf8 = 'Deno' in globalThis ? Deno.core.encode : (()=>{
    const encoder2 = new TextEncoder();
    return (string)=>encoder2.encode(string)
    ;
})();
const decode_utf8 = 'Deno' in globalThis ? Deno.core.decode : (()=>{
    const decoder1 = new TextDecoder();
    return (buffer)=>decoder1.decode(buffer)
    ;
})();
if ('FinalizationRegistry' in globalThis) {
    registry = new FinalizationRegistry(([t, ptr])=>{
        if (t === 0) wasm2.font_free(ptr);
        if (t === 1) wasm2.layout_free(ptr);
    });
}
class Font {
    constructor(scale1, buffer1){
        this.scale = scale1;
        const ptr1 = mem1.alloc(buffer1.length);
        mem1.u8(ptr1, buffer1.length).set(buffer1);
        this.ptr = wasm2.font_new(ptr1, buffer1.length, scale1);
        if (!this.ptr) throw new Error('invalid font');
        if (registry) registry.register(this, [
            0,
            this.ptr
        ], this);
    }
    free() {
        this.ptr = wasm2.font_free(this.ptr);
        if (registry) registry.unregister(this);
    }
    has(__char) {
        return wasm2.font_has(this.ptr, String.prototype.charCodeAt.call(__char, 0));
    }
    metrics(__char, scale = this.scale) {
        const ptr1 = wasm2.font_metrics(this.ptr, String.prototype.charCodeAt.call(__char, 0), scale);
        const metrics = JSON.parse(decode_utf8(mem1.u8(wasm2.font_metrics_buffer(ptr1), mem1.length())));
        return wasm2.font_metrics_free(ptr1), metrics;
    }
    rasterize(__char, scale = this.scale) {
        const ptr1 = wasm2.font_rasterize(this.ptr, String.prototype.charCodeAt.call(__char, 0), scale);
        const glyph = {
            buffer: mem1.u8(wasm2.font_rasterize_buffer(ptr1), mem1.length()).slice(),
            metrics: JSON.parse(decode_utf8(mem1.u8(wasm2.font_rasterize_metrics(ptr1), mem1.length())))
        };
        return wasm2.font_rasterize_free(ptr1), glyph;
    }
}
class Layout {
    constructor(){
        this.ptr = wasm2.layout_new();
        if (registry) this.refs = [];
        if (registry) registry.register(this, [
            1,
            this.ptr
        ], this);
    }
    clear() {
        wasm2.layout_clear(this.ptr);
        if (registry) this.refs.length = 0;
    }
    lines() {
        return wasm2.layout_lines(this.ptr);
    }
    free() {
        if (registry) this.refs.length = 0;
        this.ptr = wasm2.layout_free(this.ptr);
        if (registry) registry.unregister(this);
    }
    reset(options = {
    }) {
        options = encode_utf8(JSON.stringify(options));
        if (registry) this.refs.length = 0;
        const ptr1 = mem1.alloc(options.length);
        mem1.u8(ptr1, options.length).set(options);
        wasm2.layout_reset(this.ptr, ptr1, options.length);
    }
    append(font, text, init) {
        text = encode_utf8(text);
        const options = init || {
        };
        if (registry) this.refs.push(font);
        const ptr1 = mem1.alloc(text.length);
        mem1.u8(ptr1, text.length).set(text);
        const has_color = 'r' in options || 'g' in options || 'b' in options;
        wasm2.layout_append(this.ptr, font.ptr, ptr1, text.length, options.scale ?? font.scale, has_color, options.r, options.g, options.b);
    }
    rasterize(r, g, b) {
        const ptr1 = wasm2.layout_rasterize(this.ptr, r, g, b);
        const framebuffer = {
            width: wasm2.layout_rasterize_width(ptr1),
            height: wasm2.layout_rasterize_height(ptr1),
            buffer: mem1.u8(wasm2.layout_rasterize_buffer(ptr1), mem1.length()).slice()
        };
        return wasm2.layout_rasterize_free(ptr1), framebuffer;
    }
}
const importMeta4 = {
    url: "https://deno.land/x/imagescript@1.2.7/utils/wasm/svg.js",
    main: false
};
let wasm3;
{
    const path2 = new URL(importMeta4.url.replace('.js', '.wasm'));
    const module = new WebAssembly.Module(await ('file:' === path2.protocol ? Deno.readFile(path2) : fetch(path2).then((r2)=>r2.arrayBuffer()
    )));
    const instance = new WebAssembly.Instance(module);
    wasm3 = instance.exports;
}class mem2 {
    static length() {
        return wasm3.wlen();
    }
    static alloc(size) {
        return wasm3.walloc(size);
    }
    static free(ptr, size) {
        return wasm3.wfree(ptr, size);
    }
    static u8(ptr, size) {
        return new Uint8Array(wasm3.memory.buffer, ptr, size);
    }
    static u32(ptr, size) {
        return new Uint32Array(wasm3.memory.buffer, ptr, size);
    }
    static copy_and_free(ptr, size) {
        let slice = mem2.u8(ptr, size).slice();
        return wasm3.wfree(ptr, size), slice;
    }
}
function rasterize(buffer1, fit, scale2) {
    const bptr = mem2.alloc(buffer1.length);
    mem2.u8(bptr, buffer1.length).set(buffer1);
    const ptr2 = wasm3.rasterize(bptr, buffer1.length, fit, scale2);
    if (0 === ptr2) throw new Error('svg: failed to parse');
    if (1 === ptr2) throw new Error('svg: failed to rasterize');
    const framebuffer = {
        width: wasm3.rasterize_width(ptr2),
        height: wasm3.rasterize_height(ptr2),
        buffer: mem2.u8(wasm3.rasterize_buffer(ptr2), mem2.length()).slice()
    };
    return wasm3.rasterize_free(ptr2), framebuffer;
}
const importMeta5 = {
    url: "https://deno.land/x/imagescript@1.2.7/utils/wasm/jpeg.js",
    main: false
};
let wasm4;
{
    const path2 = new URL(importMeta5.url.replace('.js', '.wasm'));
    const module = new WebAssembly.Module(await ('file:' === path2.protocol ? Deno.readFile(path2) : fetch(path2).then((r2)=>r2.arrayBuffer()
    )));
    const instance = new WebAssembly.Instance(module);
    wasm4 = instance.exports;
}class mem3 {
    static length() {
        return wasm4.wlen();
    }
    static alloc(size) {
        return wasm4.walloc(size);
    }
    static free(ptr, size) {
        return wasm4.wfree(ptr, size);
    }
    static u8(ptr, size) {
        return new Uint8Array(wasm4.memory.buffer, ptr, size);
    }
    static u32(ptr, size) {
        return new Uint32Array(wasm4.memory.buffer, ptr, size);
    }
    static copy_and_free(ptr, size) {
        let slice = mem3.u8(ptr, size).slice();
        return wasm4.wfree(ptr, size), slice;
    }
}
function encode3(buffer1, width, height, quality) {
    const ptr2 = mem3.alloc(buffer1.length);
    mem3.u8(ptr2, buffer1.length).set(buffer1);
    return mem3.copy_and_free(wasm4.encode(ptr2, width, height, quality), mem3.length());
}
function decode2(buffer1, width, height) {
    const bptr = mem3.alloc(buffer1.length);
    mem3.u8(bptr, buffer1.length).set(buffer1);
    const ptr2 = wasm4.decode(bptr, buffer1.length, width, height);
    if (0 === ptr2) throw new Error('jpg: failed to decode');
    if (1 === ptr2) throw new Error('jpg: failed to scale decoder');
    const framebuffer = {
        width: wasm4.decode_width(ptr2),
        height: wasm4.decode_height(ptr2),
        format: wasm4.decode_format(ptr2),
        buffer: mem3.u8(wasm4.decode_buffer(ptr2), mem3.length()).slice()
    };
    return wasm4.decode_free(ptr2), framebuffer;
}
const importMeta6 = {
    url: "https://deno.land/x/imagescript@1.2.7/utils/wasm/gif.js",
    main: false
};
let wasm5;
const streams = new Map;
const utf8encoder = new TextEncoder;
{
    const path2 = new URL(importMeta6.url.replace('.js', '.wasm'));
    const module = new WebAssembly.Module(await ('file:' === path2.protocol ? Deno.readFile(path2) : fetch(path2).then((r2)=>r2.arrayBuffer()
    )));
    const instance = new WebAssembly.Instance(module, {
        env: {
            push_to_stream (id, ptr) {
                streams.get(id).cb(mem5.u8(ptr, mem5.length()).slice());
            }
        }
    });
    wasm5 = instance.exports;
}class mem5 {
    static length() {
        return wasm5.wlen();
    }
    static alloc(size) {
        return wasm5.walloc(size);
    }
    static free(ptr, size) {
        return wasm5.wfree(ptr, size);
    }
    static u8(ptr, size) {
        return new Uint8Array(wasm5.memory.buffer, ptr, size);
    }
    static u32(ptr, size) {
        return new Uint32Array(wasm5.memory.buffer, ptr, size);
    }
    static copy_and_free(ptr, size) {
        let slice = mem5.u8(ptr, size).slice();
        return wasm5.wfree(ptr, size), slice;
    }
}
class Encoder {
    constructor(width1, height1, loops = -1){
        this.slices = [];
        streams.set(0, this);
        this.ptr = wasm5.encoder_new(0, width1, height1, loops);
    }
    cb(buffer) {
        this.slices.push(buffer);
    }
    free() {
        this.ptr = wasm5.encoder_free(this.ptr);
        streams.delete(0);
    }
    u8() {
        this.free();
        let offset = 0;
        const u8 = new Uint8Array(this.slices.reduce((sum, array)=>sum + array.length
        , 0));
        for (const x of this.slices){
            u8.set(x, offset);
            offset += x.length;
        }
        return u8;
    }
    add(x, y, delay, width, height, buffer, dispose, quality) {
        const ptr2 = mem5.alloc(buffer.length);
        mem5.u8(ptr2, buffer.length).set(buffer);
        wasm5.encoder_add(this.ptr, ptr2, buffer.length, x, y, width, height, delay, dispose, quality);
    }
    set comment(comment) {
        const buffer2 = utf8encoder.encode(comment);
        const ptr2 = mem5.alloc(buffer2.length);
        mem5.u8(ptr2, buffer2.length).set(buffer2);
        wasm5.encoder_add_comment(this.ptr, ptr2, buffer2.length);
    }
    set application(application) {
        const buffer2 = utf8encoder.encode(application);
        const ptr2 = mem5.alloc(buffer2.length);
        mem5.u8(ptr2, buffer2.length).set(buffer2);
        wasm5.encoder_add_application(this.ptr, ptr2, buffer2.length);
    }
}
class Decoder {
    constructor(buffer2, limit = 0){
        const bptr = mem5.alloc(buffer2.length);
        mem5.u8(bptr, buffer2.length).set(buffer2);
        this.ptr = wasm5.decoder_new(bptr, buffer2.length, limit);
        if (0 === this.ptr) throw new Error('gif: failed to parse gif header');
        this.width = wasm5.decoder_width(this.ptr);
        this.height = wasm5.decoder_height(this.ptr);
    }
    free() {
        this.ptr = wasm5.decoder_free(this.ptr);
    }
    *frames() {
        let frame;
        while(frame = this.frame())yield frame;
    }
    frame() {
        const ptr2 = wasm5.decoder_frame(this.ptr);
        if (1 === ptr2) return null;
        if (0 === ptr2) throw this.free(), new Error('gif: failed to decode frame');
        const framebuffer = {
            x: wasm5.decoder_frame_x(ptr2),
            y: wasm5.decoder_frame_y(ptr2),
            delay: wasm5.decoder_frame_delay(ptr2),
            width: wasm5.decoder_frame_width(ptr2),
            height: wasm5.decoder_frame_height(ptr2),
            dispose: wasm5.decoder_frame_dispose(ptr2),
            buffer: mem5.u8(wasm5.decoder_frame_buffer(ptr2), mem5.length()).slice()
        };
        return wasm5.decoder_frame_free(ptr2), framebuffer;
    }
}
const MAGIC_NUMBERS = {
    PNG: 2303741511,
    JPEG: 16767231,
    TIFF: 1229531648,
    GIF: 4671814
};
class Image1 {
    constructor(width2, height2){
        width2 = ~~width2;
        height2 = ~~height2;
        if (width2 < 1) throw new RangeError('Image has to be at least 1 pixel wide');
        if (height2 < 1) throw new RangeError('Image has to be at least 1 pixel high');
        this.__width__ = width2;
        this.__height__ = height2;
        this.__buffer__ = new ArrayBuffer(width2 * height2 * 4);
        this.__view__ = new DataView(this.__buffer__);
        this.__u32__ = new Uint32Array(this.__buffer__);
        this.bitmap = new Uint8ClampedArray(this.__buffer__);
    }
    toString() {
        return `Image<${this.width}x${this.height}>`;
    }
    get width() {
        return this.__width__;
    }
    get height() {
        return this.__height__;
    }
    *[Symbol.iterator]() {
        for(let y = 1; y <= this.height; y++){
            for(let x = 1; x <= this.width; x++){
                yield [
                    x,
                    y
                ];
            }
        }
    }
    *iterateWithColors() {
        let offset = 0;
        for(let y = 1; y <= this.height; y++){
            for(let x = 1; x <= this.width; x++){
                yield [
                    x,
                    y,
                    this.__view__.getUint32(offset, false)
                ];
                offset += 4;
            }
        }
    }
    static rgbaToColor(r, g, b, a) {
        return ((r & 255) << 24 | (g & 255) << 16 | (b & 255) << 8 | a & 255) >>> 0;
    }
    static rgbToColor(r, g, b) {
        return Image1.rgbaToColor(r, g, b, 255);
    }
    static hslaToColor(h, s, l, a) {
        h %= 1;
        s = Math.min(1, Math.max(0, s));
        l = Math.min(1, Math.max(0, l));
        a = Math.min(1, Math.max(0, a));
        let r2, g, b;
        if (s === 0) {
            r2 = g = b = l;
        } else {
            const hue2rgb = (p, q, t)=>{
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r2 = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return Image1.rgbaToColor(r2 * 255, g * 255, b * 255, a * 255);
    }
    static hslToColor(h, s, l) {
        return Image1.hslaToColor(h, s, l, 1);
    }
    static rgbaToHSLA(r, g, b, a) {
        r /= 255;
        g /= 255;
        b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch(max){
                case r:
                    h = (g - b) / d + (g < b ? 6 : 0);
                    break;
                case g:
                    h = (b - r) / d + 2;
                    break;
                case b:
                    h = (r - g) / d + 4;
                    break;
            }
            h /= 6;
        }
        return [
            h,
            s,
            l,
            a / 255
        ];
    }
    static colorToRGBA(color) {
        return [
            color >> 24 & 255,
            color >> 16 & 255,
            color >> 8 & 255,
            color & 255
        ];
    }
    static colorToRGB(color) {
        return Image1.colorToRGBA(color).slice(0, 3);
    }
    getPixelAt(x, y) {
        this.__check_boundaries__(x, y);
        return this.__view__.getUint32(((~~y - 1) * this.width + (~~x - 1)) * 4, false);
    }
    getRGBAAt(x, y) {
        this.__check_boundaries__(x, y);
        const idx = ((~~y - 1) * this.width + (~~x - 1)) * 4;
        return this.bitmap.subarray(idx, idx + 4);
    }
    setPixelAt(x, y, pixelColor) {
        x = ~~x;
        y = ~~y;
        this.__check_boundaries__(x, y);
        this.__set_pixel__(x, y, pixelColor);
        return this;
    }
    __set_pixel__(x, y, pixelColor) {
        this.__view__.setUint32(((y - 1) * this.width + (x - 1)) * 4, pixelColor, false);
    }
    __check_boundaries__(x, y) {
        if (isNaN(x)) throw new TypeError(`Invalid pixel coordinates (x=${x})`);
        if (isNaN(y)) throw new TypeError(`Invalid pixel coordinates (y=${y})`);
        if (x < 1) throw new RangeError(`${Image1.__out_of_bounds__} (x=${x})<1`);
        if (x > this.width) throw new RangeError(`${Image1.__out_of_bounds__} (x=${x})>(width=${this.width})`);
        if (y < 1) throw new RangeError(`${Image1.__out_of_bounds__} (y=${y})<1`);
        if (y > this.height) throw new RangeError(`${Image1.__out_of_bounds__} (y=${y})>(height=${this.height})`);
    }
    static get __out_of_bounds__() {
        return 'Tried referencing a pixel outside of the images boundaries:';
    }
    fill(color) {
        const type = typeof color;
        if (type !== 'function') {
            this.__view__.setUint32(0, color, false);
            this.__u32__.fill(this.__u32__[0]);
        } else {
            let offset = 0;
            for(let y = 1; y <= this.height; y++){
                for(let x = 1; x <= this.width; x++){
                    this.__view__.setUint32(offset, color(x, y), false);
                    offset += 4;
                }
            }
        }
        return this;
    }
    clone() {
        const image = new Image1(this.width, this.height);
        image.bitmap.set(this.bitmap);
        return image;
    }
    static get RESIZE_NEAREST_NEIGHBOR() {
        return 'RESIZE_NEAREST_NEIGHBOR';
    }
    static get RESIZE_AUTO() {
        return -1;
    }
    scale(factor, mode = Image1.RESIZE_NEAREST_NEIGHBOR) {
        if (factor === 1) return this;
        return this.resize(this.width * factor, this.height * factor, mode);
    }
    resize(width, height, mode = Image1.RESIZE_NEAREST_NEIGHBOR) {
        if (width === Image1.RESIZE_AUTO && height === Image1.RESIZE_AUTO) throw new Error('RESIZE_AUTO can only be used for either width or height, not for both');
        else if (width === Image1.RESIZE_AUTO) width = this.width / this.height * height;
        else if (height === Image1.RESIZE_AUTO) height = this.height / this.width * width;
        width = Math.floor(width);
        height = Math.floor(height);
        if (width < 1) throw new RangeError('Image has to be at least 1 pixel wide');
        if (height < 1) throw new RangeError('Image has to be at least 1 pixel high');
        if (mode === Image1.RESIZE_NEAREST_NEIGHBOR) return this.__resize_nearest_neighbor__(width, height);
        else throw new Error('Invalid resize mode');
    }
    __resize_nearest_neighbor__(width, height) {
        const image = new this.constructor(width, height);
        for(let y = 0; y < height; y++){
            for(let x = 0; x < width; x++){
                const ySrc = Math.floor(y * this.height / height);
                const xSrc = Math.floor(x * this.width / width);
                const destPos = (y * width + x) * 4;
                const srcPos = (ySrc * this.width + xSrc) * 4;
                image.__view__.setUint32(destPos, this.__view__.getUint32(srcPos, false), false);
            }
        }
        this.__apply__(image);
        return this;
    }
    crop(x, y, width, height) {
        if (width > this.width) width = this.width;
        if (height > this.height) height = this.height;
        return this.__apply__(this.__crop__(~~x, ~~y, ~~width, ~~height));
    }
    __crop__(x, y, width, height) {
        x = ~~x;
        y = ~~y;
        const image = new this.constructor(width, height);
        for(let tY = 0; tY < height; tY++){
            const idx = (tY + y) * this.width + x;
            image.__u32__.set(this.__u32__.subarray(idx, idx + width), tY * width);
        }
        return image;
    }
    drawBox(x, y, width, height, color) {
        x = ~~(x - 1);
        y = ~~(y - 1);
        width = ~~width;
        height = ~~height;
        if (typeof color === 'function') {
            for(let tY = 1; tY <= height; tY++){
                for(let tX = 1; tX <= width; tX++){
                    const nX = tX + x;
                    const nY = tY + y;
                    if (Math.min(nX, nY) < 1 || nX > this.width || nY > this.height) continue;
                    const tC = color(tX, tY);
                    this.__set_pixel__(nX, nY, tC);
                }
            }
        } else return this.__fast_box__(x, y, width, height, color);
        return this;
    }
    __fast_box__(x, y, width, height, color) {
        if (x < 0) {
            width += x;
            x = 1;
        }
        if (y < 0) {
            height += y;
            y = 1;
        }
        const right = Math.max(Math.min(x + width, this.width), 1);
        let xPos = right;
        while(x <= --xPos)this.__view__.setUint32(4 * (xPos + y * this.width), color);
        const end = 4 * (right + y * this.width);
        const start = 4 * (x + y * this.width);
        let bottom = Math.max(Math.min(y + height, this.height), 1);
        while(y < --bottom)this.bitmap.copyWithin(4 * (x + bottom * this.width), start, end);
        return this;
    }
    drawCircle(x, y, radius, color) {
        const radSquared = radius ** 2;
        for(let currentY = Math.max(1, y - radius); currentY <= Math.min(y + radius, this.height); currentY++){
            for(let currentX = Math.max(1, x - radius); currentX <= Math.min(x + radius, this.width); currentX++){
                if ((currentX - x) ** 2 + (currentY - y) ** 2 < radSquared) this.__set_pixel__(currentX, currentY, typeof color === 'function' ? color(currentX - x + radius, currentY - y + radius) : color);
            }
        }
        return this;
    }
    cropCircle(max = false, feathering = 0) {
        const rad = Math[max ? 'max' : 'min'](this.width, this.height) / 2;
        const radSquared = rad ** 2;
        const centerX = this.width / 2;
        const centerY = this.height / 2;
        for (const [x, y] of this){
            const distanceFromCenter = (x - centerX) ** 2 + (y - centerY) ** 2;
            const alphaIdx = ((y - 1) * this.width + (x - 1)) * 4 + 3;
            if (distanceFromCenter > radSquared) this.bitmap[alphaIdx] = 0;
            else if (feathering) this.bitmap[alphaIdx] *= Math.max(0, Math.min(1, 1 - distanceFromCenter / radSquared * feathering ** (1 / 2)));
        }
        return this;
    }
    opacity(opacity, absolute = false) {
        if (isNaN(opacity) || opacity < 0) throw new RangeError('Invalid opacity value');
        this.__set_channel_value__(opacity, absolute, 3);
        return this;
    }
    red(saturation, absolute = false) {
        if (isNaN(saturation) || saturation < 0) throw new RangeError('Invalid saturation value');
        this.__set_channel_value__(saturation, absolute, 0);
        return this;
    }
    green(saturation, absolute = false) {
        if (isNaN(saturation) || saturation < 0) throw new RangeError('Invalid saturation value');
        this.__set_channel_value__(saturation, absolute, 1);
        return this;
    }
    blue(saturation, absolute = false) {
        if (isNaN(saturation) || saturation < 0) throw new RangeError('Invalid saturation value');
        this.__set_channel_value__(saturation, absolute, 2);
        return this;
    }
    __set_channel_value__(value, absolute, offset) {
        for(let i = offset; i < this.bitmap.length; i += 4)this.bitmap[i] = value * (absolute ? 255 : this.bitmap[i]);
    }
    lightness(value, absolute = false) {
        if (isNaN(value) || value < 0) throw new RangeError('Invalid lightness value');
        return this.fill((x, y)=>{
            const [h, s, l, a] = Image1.rgbaToHSLA(...this.getRGBAAt(x, y));
            return Image1.hslaToColor(h, s, value * (absolute ? 1 : l), a);
        });
    }
    saturation(value, absolute = false) {
        if (isNaN(value) || value < 0) throw new RangeError('Invalid saturation value');
        return this.fill((x, y)=>{
            const [h, s, l, a] = Image1.rgbaToHSLA(...this.getRGBAAt(x, y));
            return Image1.hslaToColor(h, value * (absolute ? 1 : s), l, a);
        });
    }
    composite(source, x = 0, y = 0) {
        x = ~~x;
        y = ~~y;
        for(let yy = 0; yy < source.height; yy++){
            let y_offset = y + yy;
            if (y_offset < 0) continue;
            if (y_offset >= this.height) break;
            for(let xx = 0; xx < source.width; xx++){
                let x_offset = x + xx;
                if (x_offset < 0) continue;
                if (x_offset >= this.width) break;
                const offset = 4 * (x_offset + y_offset * this.width);
                const fg = source.__view__.getUint32(4 * (xx + yy * source.width), false);
                const bg = this.__view__.getUint32(offset, false);
                if ((fg & 255) === 255) this.__view__.setUint32(offset, fg, false);
                else if ((fg & 255) === 0) this.__view__.setUint32(offset, bg, false);
                else this.__view__.setUint32(offset, Image1.__alpha_blend__(fg, bg), false);
            }
        }
        return this;
    }
    static __alpha_blend__(fg, bg) {
        const fa = fg & 255;
        const alpha = fa + 1;
        const inv_alpha = 256 - fa;
        const r2 = alpha * (fg >>> 24) + inv_alpha * (bg >>> 24) >> 8;
        const b = alpha * (fg >> 8 & 255) + inv_alpha * (bg >> 8 & 255) >> 8;
        const g = alpha * (fg >> 16 & 255) + inv_alpha * (bg >> 16 & 255) >> 8;
        return (r2 & 255) << 24 | (g & 255) << 16 | (b & 255) << 8 | Math.max(fa, bg & 255) & 255;
    }
    invert() {
        for (const [x, y, color] of this.iterateWithColors())this.__set_pixel__(x, y, 4294967295 - color & 4294967040 | color & 255);
        return this;
    }
    invertValue() {
        for (const [x, y, color] of this.iterateWithColors()){
            const [h, s, l, a] = Image1.rgbaToHSLA(...Image1.colorToRGBA(color));
            this.__set_pixel__(x, y, Image1.hslaToColor(h, s, 1 - l, a));
        }
        return this;
    }
    invertSaturation() {
        for (const [x, y, color] of this.iterateWithColors()){
            const [h, s, l, a] = Image1.rgbaToHSLA(...Image1.colorToRGBA(color));
            this.__set_pixel__(x, y, Image1.hslaToColor(h, 1 - s, l, a));
        }
        return this;
    }
    invertHue() {
        for (const [x, y, color] of this.iterateWithColors()){
            const [h, s, l, a] = Image1.rgbaToHSLA(...Image1.colorToRGBA(color));
            this.__set_pixel__(x, y, Image1.hslaToColor(1 - h, s, l, a));
        }
        return this;
    }
    hueShift(degrees) {
        for (const [x, y, color] of this.iterateWithColors()){
            const [h, s, l, a] = Image1.rgbaToHSLA(...Image1.colorToRGBA(color));
            this.__set_pixel__(x, y, Image1.hslaToColor(h + degrees / 360, s, l, a));
        }
        return this;
    }
    averageColor() {
        let colorAvg = [
            0,
            0,
            0
        ];
        let divisor = 0;
        for(let idx = 0; idx < this.bitmap.length; idx += 4){
            const rgba = this.bitmap.subarray(idx, idx + 4);
            for(let i = 0; i < 3; i++)colorAvg[i] += rgba[i];
            divisor += rgba[3] / 255;
        }
        return Image1.rgbaToColor(...colorAvg.map((v)=>v / divisor
        ), 255);
    }
    dominantColor(ignoreBlack = true, ignoreWhite = true, bwThreshold = 15) {
        const colorCounts = new Array(262143);
        for(let i = 0; i < this.bitmap.length; i += 4){
            const color = this.__view__.getUint32(i, false);
            const [h, s, l] = Image1.rgbaToHSLA(...Image1.colorToRGBA(color)).map((v)=>~~(v * 63)
            );
            if (ignoreBlack && l < bwThreshold) continue;
            if (ignoreWhite && l > 63 - bwThreshold) continue;
            const key = h << 12 | s << 6 | l;
            colorCounts[key] = (colorCounts[key] || 0) + 1;
        }
        let maxColorCount = -1;
        let mostProminentValue = 0;
        colorCounts.forEach((el, i1)=>{
            if (el < maxColorCount) return;
            maxColorCount = el;
            mostProminentValue = i1;
        });
        if (mostProminentValue === -1) return this.dominantColor(ignoreBlack, ignoreWhite, bwThreshold - 1);
        const h = mostProminentValue >>> 12 & 63;
        const s = mostProminentValue >>> 6 & 63;
        const l = mostProminentValue & 63;
        return Image1.hslaToColor(h / 63, s / 63, l / 63, 1);
    }
    rotate(angle, resize = true) {
        if (angle % 360 === 0) return this;
        if (angle % 180 === 0) return this.__rotate_180__();
        const rad = Math.PI * (angle / 180);
        const sin = Math.sin(rad);
        const cos = Math.cos(rad);
        const width3 = resize ? Math.abs(this.width * sin) + Math.abs(this.height * cos) : this.width;
        const height3 = resize ? Math.abs(this.width * cos) + Math.abs(this.height * sin) : this.height;
        const out = new Image1(width3, height3);
        const out_cx = width3 / 2 - 0.5;
        const out_cy = height3 / 2 - 0.5;
        const src_cx = this.width / 2 - 0.5;
        const src_cy = this.height / 2 - 0.5;
        let h = 0;
        do {
            let w = 0;
            const ysin = src_cx - sin * (h - out_cy);
            const ycos = src_cy + cos * (h - out_cy);
            do {
                const xf = ysin + cos * (w - out_cx);
                const yf = ycos + sin * (w - out_cx);
                Image1.__interpolate__(this, out, w, h, xf, yf);
            }while ((w++) < width3)
        }while ((h++) < height3)
        return this.__apply__(out);
    }
    __rotate_180__() {
        let offset = 0;
        this.bitmap.reverse();
        while(offset < this.bitmap.length)this.bitmap.subarray(offset, offset += 4).reverse();
        return this;
    }
    static __interpolate__(src, out, x0, y0, x1, y1) {
        const x2 = ~~x1;
        const y2 = ~~y1;
        const xq = x1 - x2;
        const yq = y1 - y2;
        const out_slice = out.bitmap.subarray(4 * (x0 + y0 * out.width), -4);
        const ref = {
            r: 0,
            g: 0,
            b: 0,
            a: 0
        };
        Image1.__pawn__(x2, y2, (1 - xq) * (1 - yq), ref, src);
        Image1.__pawn__(1 + x2, y2, xq * (1 - yq), ref, src);
        Image1.__pawn__(x2, 1 + y2, (1 - xq) * yq, ref, src);
        Image1.__pawn__(1 + x2, 1 + y2, xq * yq, ref, src);
        out_slice[3] = ref.a;
        out_slice[0] = ref.r / ref.a;
        out_slice[1] = ref.g / ref.a;
        out_slice[2] = ref.b / ref.a;
    }
    static __pawn__(point0, point1, weight, ref, src) {
        if (point0 > 0 && point1 > 0 && point0 < src.width && point1 < src.height) {
            const offset = 4 * (point0 + point1 * src.width);
            const src_slice = src.bitmap.subarray(offset, offset + 4);
            const wa = weight * src_slice[3];
            ref.a += wa;
            ref.r += wa * src_slice[0];
            ref.g += wa * src_slice[1];
            ref.b += wa * src_slice[2];
        }
    }
    __apply__(image) {
        this.__width__ = image.__width__;
        this.__height__ = image.__height__;
        this.__view__ = image.__view__;
        this.__u32__ = image.__u32__;
        this.bitmap = image.bitmap;
        if (image instanceof Frame) return Frame.from(this, image.duration, image.xOffset, image.yOffset, image.disposalMode);
        return this;
    }
    static gradient(colors) {
        const entries = Object.entries(colors).sort((a, b)=>a[0] - b[0]
        );
        const positions = entries.map((e)=>parseFloat(e[0])
        );
        const values = entries.map((e)=>e[1]
        );
        if (positions.length === 0) throw new RangeError('Invalid gradient point count');
        else if (positions.length === 1) {
            return ()=>values[0]
            ;
        } else if (positions.length === 2) {
            const gradient = this.__gradient__(values[0], values[1]);
            return (position)=>{
                if (position <= positions[0]) return values[0];
                if (position >= positions[1]) return values[1];
                return gradient((position - positions[0]) / (positions[1] - positions[0]));
            };
        }
        const minDef = Math.min(...positions);
        const maxDef = Math.max(...positions);
        let gradients = [];
        for(let i = 0; i < positions.length; i++){
            let minPos = positions[i - 1];
            if (minPos === undefined) continue;
            let maxPos = positions[i];
            let minVal = values[i - 1];
            if (minVal === undefined) minVal = values[i];
            const maxVal = values[i];
            const gradient = this.__gradient__(minVal, maxVal);
            gradients.push({
                min: minPos,
                max: maxPos,
                gradient
            });
        }
        return (position)=>{
            if (position <= minDef) return gradients[0].gradient(0);
            if (position >= maxDef) return gradients[gradients.length - 1].gradient(1);
            for (const gradient of gradients)if (position >= gradient.min && position <= gradient.max) return gradient.gradient((position - gradient.min) / (gradient.max - gradient.min));
            throw new RangeError(`Invalid gradient position: ${position}`);
        };
    }
    roundCorners(radius = Math.min(this.width, this.height) / 4) {
        const radSquared = radius ** 2;
        for(let x = 1; x <= radius; x++){
            const xRad = (x - radius) ** 2;
            for(let y = 1; y <= radius; y++){
                if (xRad + (y - radius) ** 2 > radSquared) this.bitmap[((y - 1) * this.width + x - 1) * 4 + 3] = 0;
            }
        }
        for(let x1 = 1; x1 <= radius; x1++){
            const xRad = (x1 - radius) ** 2;
            for(let y = this.height - radius; y <= this.height; y++){
                if (xRad + (this.height - y - radius) ** 2 > radSquared) this.bitmap[((y - 1) * this.width + x1 - 1) * 4 + 3] = 0;
            }
        }
        for(let x2 = this.width - radius; x2 <= this.width; x2++){
            const xRad = (this.width - x2 - radius) ** 2;
            for(let y = 1; y <= radius; y++){
                if (xRad + (y - radius) ** 2 > radSquared) this.bitmap[((y - 1) * this.width + x2 - 1) * 4 + 3] = 0;
            }
        }
        for(let x3 = this.width - radius; x3 <= this.width; x3++){
            const xRad = (this.width - x3 - radius) ** 2;
            for(let y = this.height - radius; y <= this.height; y++){
                if (xRad + (this.height - y - radius) ** 2 > radSquared) this.bitmap[((y - 1) * this.width + x3 - 1) * 4 + 3] = 0;
            }
        }
        return this;
    }
    static __gradient__(startColor, endColor) {
        const sr = startColor >>> 24;
        const sg = startColor >> 16 & 255;
        const sb = startColor >> 8 & 255;
        const sa = startColor & 255;
        const er = (endColor >>> 24) - sr;
        const eg = (endColor >> 16 & 255) - sg;
        const eb = (endColor >> 8 & 255) - sb;
        const ea = (endColor & 255) - sa;
        return (position)=>{
            const r2 = sr + position * er;
            const g = sg + position * eg;
            const b = sb + position * eb;
            const a = sa + position * ea;
            return (r2 & 255) << 24 | (g & 255) << 16 | (b & 255) << 8 | a & 255;
        };
    }
    fisheye(radius = 2) {
        const r2 = new Image1(this.width, this.height);
        const w = this.width;
        const h = this.height;
        const tu32 = this.__u32__;
        const ru32 = r2.__u32__;
        const iw = 1 / w;
        const ih = 1 / h;
        for (const [x, y] of this){
            const xco = x * iw - 0.5;
            const yco = y * ih - 0.5;
            const dfc = Math.sqrt(xco ** 2 + yco ** 2);
            const dis = 2 * dfc ** radius;
            const nx = (dis * xco / dfc + 0.5) * w | 0;
            const ny = (dis * yco / dfc + 0.5) * h | 0;
            if (nx < 1 || nx > w || ny < 1 || ny > h || isNaN(nx) || isNaN(ny)) continue;
            ru32[y * w + x] = tu32[w * ny + nx];
        }
        const cO = tu32.length * 0.5 + w / 2;
        ru32[cO] = tu32[cO];
        return this.__apply__(r2);
    }
    async encode(compression = 1) {
        return await encode2(this.bitmap, {
            width: this.width,
            height: this.height,
            level: compression,
            channels: 4
        });
    }
    async encodeJPEG(quality = 90) {
        return encode3(this.bitmap, this.width, this.height, Math.max(1, Math.min(100, quality)));
    }
    static async decode(data) {
        let image;
        let view;
        if (!ArrayBuffer.isView(data)) {
            data = new Uint8Array(data);
            view = new DataView(data.buffer);
        } else {
            data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        }
        if (ImageType.isPNG(view)) {
            const { width: width3 , height: height3 , pixels  } = await decode1(data);
            image = new Image1(width3, height3);
            image.bitmap.set(pixels);
        } else if (ImageType.isJPEG(view)) {
            const framebuffer = decode2(data);
            const width3 = framebuffer.width;
            const height3 = framebuffer.height;
            const pixelType = framebuffer.format;
            image = new Image1(width3, height3);
            const buffer3 = framebuffer.buffer;
            if (pixelType === 0) {
                const view1 = new DataView(image.bitmap.buffer);
                for(let i = 0; i < buffer3.length; i++){
                    const pixel = buffer3[i];
                    view1.setUint32(i * 4, pixel << 24 | pixel << 16 | pixel << 8 | 255, false);
                }
            } else if (pixelType === 1) {
                image.bitmap.fill(255);
                for(let i = 0; i < width3 * height3; i++)image.bitmap.set(buffer3.subarray(i * 3, i * 3 + 3), i * 4);
            } else if (pixelType === 2) {
                for(let i = 0; i < buffer3.length; i += 4){
                    image.bitmap[i] = 255 * (1 - buffer3[i] / 255) * (1 - buffer3[i + 3] / 255);
                    image.bitmap[i + 1] = 255 * (1 - buffer3[i + 1] / 255) * (1 - buffer3[i + 3] / 255);
                    image.bitmap[i + 2] = 255 * (1 - buffer3[i + 2] / 255) * (1 - buffer3[i + 3] / 255);
                    image.bitmap[i + 3] = 255;
                }
            }
        } else if (ImageType.isTIFF(view)) {
            const status = await tifflib.decode(0, data);
            if (status === 1) throw new Error('Failed decoding TIFF image');
            const meta = tifflib.meta(0);
            const buffer3 = tifflib.buffer(0);
            tifflib.free(0);
            image = new this(...meta);
            image.bitmap.set(buffer3);
        } else throw new Error('Unsupported image type');
        return image;
    }
    static get SVG_MODE_SCALE() {
        return 1;
    }
    static get SVG_MODE_WIDTH() {
        return 2;
    }
    static get SVG_MODE_HEIGHT() {
        return 3;
    }
    static renderSVG(svg, size = 1, mode = this.SVG_MODE_SCALE) {
        if (![
            this.SVG_MODE_WIDTH,
            this.SVG_MODE_HEIGHT,
            this.SVG_MODE_SCALE
        ].includes(mode)) throw new Error('Invalid SVG scaling mode');
        if (mode === this.SVG_MODE_SCALE && size <= 0) throw new RangeError('SVG scale must be > 0');
        if (mode !== this.SVG_MODE_SCALE && size < 1) throw new RangeError('SVG size must be >= 1');
        if (typeof svg === 'string') svg = Deno.core.encode(svg);
        const framebuffer = rasterize(svg, mode, size);
        const image = new Image1(framebuffer.width, framebuffer.height);
        image.bitmap.set(framebuffer.buffer);
        return image;
    }
    static renderText(font, scale, text, color = 4294967295, layout = new TextLayout()) {
        font = new Font(scale, font);
        const [r2, g, b, a] = Image1.colorToRGBA(color);
        const layoutOptions = new Layout();
        layoutOptions.reset({
            max_width: layout.maxWidth,
            max_height: layout.maxHeight,
            wrap_style: layout.wrapStyle,
            vertical_align: layout.verticalAlign,
            horizontal_align: layout.horizontalAlign,
            wrap_hard_breaks: layout.wrapHardBreaks
        });
        layoutOptions.append(font, text, {
            scale
        });
        const framebuffer = layoutOptions.rasterize(r2, g, b);
        const image = new Image1(framebuffer.width, framebuffer.height);
        image.bitmap.set(framebuffer.buffer);
        if (image.height > layout.maxHeight) image.crop(0, 0, image.width, Math.floor(layoutOptions.lines() / image.height * layout.maxHeight) * (image.height / layoutOptions.lines()));
        font.free();
        layoutOptions.free();
        return image.opacity(a / 255);
    }
}
class Frame extends Image1 {
    static get DISPOSAL_KEEP() {
        return 1;
    }
    static get DISPOSAL_PREVIOUS() {
        return 2;
    }
    static get DISPOSAL_BACKGROUND() {
        return 3;
    }
    constructor(width3, height3, duration1 = 100, xOffset1 = 0, yOffset1 = 0, disposalMode1 = Frame.DISPOSAL_KEEP){
        if (isNaN(duration1) || duration1 < 0) throw new RangeError('Invalid frame duration');
        super(width3, height3);
        this.duration = duration1;
        this.xOffset = xOffset1;
        this.yOffset = yOffset1;
        this.disposalMode = disposalMode1;
    }
    toString() {
        return `Frame<${this.width}x${this.height}x${this.duration}ms>`;
    }
    static from(image, duration, xOffset, yOffset, disposalMode = Frame.DISPOSAL_KEEP) {
        if (!(image instanceof Image1)) throw new TypeError('Invalid image passed');
        const frame = new Frame(image.width, image.height, duration, xOffset, yOffset, disposalMode);
        frame.bitmap.set(image.bitmap);
        return frame;
    }
    resize(width, height, mode = Image1.RESIZE_NEAREST_NEIGHBOR) {
        const originalWidth = this.width;
        const originalHeight = this.height;
        const result = super.resize(width, height, mode);
        this.xOffset *= result.width / originalWidth;
        this.yOffset *= result.height / originalHeight;
        return result;
    }
}
class GIF extends Array {
    constructor(frames, loopCount = -1){
        super(...frames);
        for (const frame of this)if (!(frame instanceof Frame)) throw new TypeError(`Frame ${this.indexOf(frame)} is not an instance of Frame`);
        if (loopCount < -1 || isNaN(loopCount)) throw new RangeError('Invalid loop count');
        this.loopCount = loopCount;
    }
    get width() {
        let max = 0;
        for (const frame1 of this){
            let width4 = frame1.width + frame1.xOffset;
            if (max < width4) max = width4;
        }
        return max;
    }
    get height() {
        let max = 0;
        for (const frame1 of this){
            let height4 = frame1.height + frame1.yOffset;
            if (max < height4) max = height4;
        }
        return max;
    }
    toString() {
        return `GIF<${this.width}x${this.height}x${this.duration}ms>`;
    }
    *[Symbol.iterator]() {
        for(let i = 0; i < this.length; i++)yield this[i];
    }
    get duration() {
        return this.reduce((acc, frame1)=>acc + frame1.duration
        , 0);
    }
    async encode(quality = 10) {
        const encoder2 = new Encoder(this.width, this.height, this.loopCount);
        for (const frame1 of this){
            if (!(frame1 instanceof Frame)) throw new Error('GIF contains invalid frames');
            encoder2.add(frame1.xOffset, frame1.yOffset, ~~(frame1.duration / 10), frame1.width, frame1.height, frame1.bitmap, frame1.disposalMode, quality);
        }
        return encoder2.u8();
    }
    static async decode(data, onlyExtractFirstFrame = false) {
        let image;
        let view;
        if (!ArrayBuffer.isView(data)) {
            data = new Uint8Array(data);
            view = new DataView(data.buffer);
        } else {
            data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        }
        if (view.getUint32(0, false) >>> 8 === 4671814) {
            const decoder1 = new Decoder(data);
            let frames1 = [];
            for (const frameData of decoder1.frames()){
                const frame1 = new Frame(frameData.width, frameData.height, frameData.delay * 10, frameData.x, frameData.y, frameData.dispose);
                frame1.bitmap.set(frameData.buffer);
                frames1.push(frame1);
                if (onlyExtractFirstFrame) break;
            }
            decoder1.free();
            image = new GIF(frames1);
        } else throw new Error('Unsupported image type');
        return image;
    }
    resize(width, height, mode = Image1.RESIZE_NEAREST_NEIGHBOR) {
        for (const frame1 of this)frame1.resize(width, height, mode);
    }
}
class TextLayout {
    constructor(options){
        const { maxWidth , maxHeight , wrapStyle , verticalAlign , horizontalAlign , wrapHardBreaks  } = options ?? {
        };
        this.maxWidth = maxWidth ?? Infinity;
        if (isNaN(this.maxWidth) || this.maxWidth < 1) throw new RangeError('Invalid maxWidth');
        this.maxHeight = maxHeight ?? Infinity;
        if (isNaN(this.maxHeight) || this.maxHeight < 1) throw new RangeError('Invalid maxHeight');
        this.wrapStyle = wrapStyle ?? 'word';
        if (![
            'word',
            'char'
        ].includes(this.wrapStyle)) throw new RangeError('Invalid wrapStyle');
        this.verticalAlign = verticalAlign ?? 'left';
        if (![
            'left',
            'center',
            'right'
        ].includes(this.verticalAlign)) throw new RangeError('Invalid verticalAlign');
        this.horizontalAlign = horizontalAlign ?? 'top';
        if (![
            'top',
            'middle',
            'bottom'
        ].includes(this.horizontalAlign)) throw new RangeError('Invalid horizontalAlign');
        this.wrapHardBreaks = wrapHardBreaks ?? true;
        if (typeof this.wrapHardBreaks !== 'boolean') throw new TypeError('Invalid wrapHardBreaks');
    }
}
class ImageType {
    static getType(data) {
        let view;
        if (!ArrayBuffer.isView(data)) {
            data = new Uint8Array(data);
            view = new DataView(data.buffer);
        } else {
            data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        }
        if (this.isPNG(view)) return 'png';
        if (this.isJPEG(view)) return 'jpeg';
        if (this.isTIFF(view)) return 'tiff';
        if (this.isGIF(view)) return 'gif';
        return null;
    }
    static isPNG(view) {
        return view.getUint32(0, false) === MAGIC_NUMBERS.PNG;
    }
    static isJPEG(view) {
        return view.getUint32(0, false) >>> 8 === MAGIC_NUMBERS.JPEG;
    }
    static isTIFF(view) {
        return view.getUint32(0, false) === MAGIC_NUMBERS.TIFF;
    }
    static isGIF(view) {
        return view.getUint32(0, false) >>> 8 === MAGIC_NUMBERS.GIF;
    }
}
function decode3(data, onlyExtractFirstFrame) {
    const type = ImageType.getType(data);
    if (type === 'gif') return GIF.decode(data, onlyExtractFirstFrame);
    return Image1.decode(data);
}
async function renderSize(originalPath, newWidth, newHeight) {
    const { pngCompression , jpgQuality  } = config.render;
    const imageBytes = await Deno.readFile(originalPath);
    const originalImage = await decode3(imageBytes);
    const originalRatioIsWider = originalImage.width / originalImage.height > newWidth / newHeight;
    if (originalImage instanceof GIF) {
        throw new Error('GIFs not supported.');
    }
    let resized;
    if (originalRatioIsWider) {
        resized = originalImage.resize(Image1.RESIZE_AUTO, newHeight);
        resized.crop((resized.width - newWidth) / 2, 0, newWidth, newHeight);
    } else {
        resized = originalImage.resize(newWidth, Image1.RESIZE_AUTO);
        resized.crop(0, (resized.height - newHeight) / 2, newWidth, newHeight);
    }
    if (!resized) {
        throw new Error('Error during image resize.');
    }
    if (parse2(originalPath).ext === 'png') {
        return resized.encode(pngCompression);
    } else {
        return resized.encodeJPEG(jpgQuality);
    }
}
function memoryMegabytes(bytes) {
    return Math.round(bytes / 1024 / 1024);
}
function logReport() {
    const { heapUsed , heapTotal , external , rss  } = Deno.memoryUsage();
    console.log('Memory summary:', `Heap ${memoryMegabytes(heapUsed)}/${memoryMegabytes(heapTotal)} MB`, '-', `External ${memoryMegabytes(external)} MB`, '-', `RSS ${memoryMegabytes(rss)} MB`);
    console.log('Cache health:', `Hit rate ${Math.round(calculateCacheHitrate() * 100)}%`, `(of ${cacheHits.length} requests)`);
}
let periodicReportingInterval = 0;
function enablePeriodicReporting() {
    periodicReportingInterval = setInterval(()=>{
        logReport();
    }, config.stats.interval);
}
const cacheHits = [];
function calculateCacheHitrate() {
    if (!cacheHits.length) {
        return 1;
    }
    return cacheHits.filter((hit)=>hit
    ).length / cacheHits.length;
}
function recordCacheHit(hit) {
    cacheHits.push(hit);
    while(cacheHits.length > config.stats.cacheHitSize){
        cacheHits.shift();
    }
}
let initialized = false;
let initializing = false;
async function init2() {
    if (initialized || initializing) {
        return;
    }
    initializing = true;
    await Deno.mkdir(config.cache.path, {
        recursive: true
    });
    initializing = false;
    initialized = true;
}
async function getCached(image, width4, height4) {
    await init2();
    if (!image.hash) {
        throw new Error('Image has no hash!');
    }
    console.log(image.hash);
    const imageCacheDir = join2(config.cache.path, image.hash);
    const filename = `${width4}x${height4}${parse2(image.path).ext}`;
    if (!await exists(imageCacheDir)) {
        console.log(imageCacheDir);
        await Deno.mkdir(imageCacheDir);
    }
    const fullPath = join2(imageCacheDir, filename);
    let cacheHit = true;
    if (!await exists(fullPath)) {
        cacheHit = false;
        const resizedBytes = await renderSize(image.path, width4, height4);
        await Deno.writeFile(fullPath, resizedBytes);
    }
    recordCacheHit(cacheHit);
    return fullPath;
}
async function respondSafe(req, res) {
    try {
        await req.respond(res);
    } catch (ex) {
        if (ex instanceof Deno.errors.ConnectionAborted) {
            return console.warn('ConnectionAborted throw prevented.');
        }
        throw ex;
    }
}
async function handleRequest(req) {
    if (req.url === '/favicon.ico') {
        req.respond({
            status: Status.NotFound,
            body: '404: favicon.ico'
        });
        return;
    }
    let params;
    try {
        params = parse4(req.url);
    } catch (ex) {
        return respondSafe(req, {
            status: Status.BadRequest,
            body: `403: ${ex.message}`
        });
    }
    if (!params.width || !params.height) {
        return respondSafe(req, {
            status: Status.BadRequest,
            body: `403: No image size specified.`
        });
    }
    const imagePath = await getCached(pickFromArray(params.category ? imageList.filter((image)=>image.category === params.category
    ) : imageList), params.width, params.height);
    const res = await serveFile(req, imagePath);
    if (!res.headers) {
        res.headers = new Headers();
    }
    res.headers.set('Cache-Control', 'no-store');
    return respondSafe(req, res);
}
if (config.stats.enabled) {
    enablePeriodicReporting();
}
const server = serve({
    port: config.webServer.port
});
for await (const req of server){
    handleRequest(req);
}
