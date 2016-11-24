// This a collection of SVG path tools that I have cludged together.
// I have credited authors where I have been able to

var SvgPathTools = (function() {

  // @info
  //   Polyfill for SVG getPathData() and setPathData() methods. Based on:
  //   - SVGPathSeg polyfill by Philip Rogers (MIT License)
  //     https://github.com/progers/pathseg
  //   - SVGPathNormalizer by Tadahisa Motooka (MIT License)
  //     https://github.com/motooka/SVGPathNormalizer/tree/master/src
  //   - arcToCubicCurves() by Dmitry Baranovskiy (MIT License)
  //     https://github.com/DmitryBaranovskiy/raphael/blob/v2.1.1/raphael.core.js#L1837
  // @author
  //   Jarosław Foksa
  // @license
  //   MIT License

  var commandsMap = {
    "Z":"Z", "M":"M", "L":"L", "C":"C", "Q":"Q", "A":"A", "H":"H", "V":"V", "S":"S", "T":"T",
    "z":"Z", "m":"m", "l":"l", "c":"c", "q":"q", "a":"a", "h":"h", "v":"v", "s":"s", "t":"t"
  };

  var Source = function(string) {
    this._string = string;
    this._currentIndex = 0;
    this._endIndex = this._string.length;
    this._prevCommand = null;
    this._skipOptionalSpaces();
  };

  Source.prototype = {

    parseSegment: function() {
      var char = this._string[this._currentIndex];
      var command = commandsMap[char] ? commandsMap[char] : null;

      if (command === null) {
        // Possibly an implicit command. Not allowed if this is the first command.
        if (this._prevCommand === null) {
          return null;
        }

        // Check for remaining coordinates in the current command.
        if (
          (char === "+" || char === "-" || char === "." || (char >= "0" && char <= "9")) && this._prevCommand !== "Z"
        ) {
          if (this._prevCommand === "M") {
            command = "L";
          }
          else if (this._prevCommand === "m") {
            command = "l";
          }
          else {
            command = this._prevCommand;
          }
        }
        else {
          command = null;
        }

        if (command === null) {
          return null;
        }
      }
      else {
        this._currentIndex += 1;
      }

      this._prevCommand = command;

      var values = null;
      var cmd = command.toUpperCase();

      if (cmd === "H" || cmd === "V") {
        values = [this._parseNumber()];
      }
      else if (cmd === "M" || cmd === "L" || cmd === "T") {
        values = [this._parseNumber(), this._parseNumber()];
      }
      else if (cmd === "S" || cmd === "Q") {
        values = [this._parseNumber(), this._parseNumber(), this._parseNumber(), this._parseNumber()];
      }
      else if (cmd === "C") {
        values = [
          this._parseNumber(),
          this._parseNumber(),
          this._parseNumber(),
          this._parseNumber(),
          this._parseNumber(),
          this._parseNumber()
        ];
      }
      else if (cmd === "A") {
        values = [
          this._parseNumber(),
          this._parseNumber(),
          this._parseNumber(),
          this._parseArcFlag(),
          this._parseArcFlag(),
          this._parseNumber(),
          this._parseNumber()
        ];
      }
      else if (cmd === "Z") {
        this._skipOptionalSpaces();
        values = [];
      }

      if (values === null || values.indexOf(null) >= 0) {
        // Unknown command or known command with invalid values
        return null;
      }
      else {
        return {type: command, values: values};
      }
    },

    hasMoreData: function() {
      return this._currentIndex < this._endIndex;
    },

    peekSegmentType: function() {
      var char = this._string[this._currentIndex];
      return commandsMap[char] ? commandsMap[char] : null;
    },

    initialCommandIsMoveTo: function() {
      // If the path is empty it is still valid, so return true.
      if (!this.hasMoreData()) {
        return true;
      }

      var command = this.peekSegmentType();
      // Path must start with moveTo.
      return command === "M" || command === "m";
    },

    _isCurrentSpace: function() {
      var char = this._string[this._currentIndex];
      return char <= " " && (char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f");
    },

    _skipOptionalSpaces: function() {
      while (this._currentIndex < this._endIndex && this._isCurrentSpace()) {
        this._currentIndex += 1;
      }

      return this._currentIndex < this._endIndex;
    },

    _skipOptionalSpacesOrDelimiter: function() {
      if (
        this._currentIndex < this._endIndex &&
        !this._isCurrentSpace() &&
        this._string[this._currentIndex] !== ","
      ) {
        return false;
      }

      if (this._skipOptionalSpaces()) {
        if (this._currentIndex < this._endIndex && this._string[this._currentIndex] === ",") {
          this._currentIndex += 1;
          this._skipOptionalSpaces();
        }
      }
      return this._currentIndex < this._endIndex;
    },

    // Parse a number from an SVG path. This very closely follows genericParseNumber(...) from
    // Source/core/svg/SVGParserUtilities.cpp.
    // Spec: http://www.w3.org/TR/SVG11/single-page.html#paths-PathDataBNF
    _parseNumber: function() {
      var exponent = 0;
      var integer = 0;
      var frac = 1;
      var decimal = 0;
      var sign = 1;
      var expsign = 1;
      var startIndex = this._currentIndex;

      this._skipOptionalSpaces();

      // Read the sign.
      if (this._currentIndex < this._endIndex && this._string[this._currentIndex] === "+") {
        this._currentIndex += 1;
      }
      else if (this._currentIndex < this._endIndex && this._string[this._currentIndex] === "-") {
        this._currentIndex += 1;
        sign = -1;
      }

      if (
        this._currentIndex === this._endIndex ||
        (
          (this._string[this._currentIndex] < "0" || this._string[this._currentIndex] > "9") &&
          this._string[this._currentIndex] !== "."
        )
      ) {
        // The first character of a number must be one of [0-9+-.].
        return null;
      }

      // Read the integer part, build right-to-left.
      var startIntPartIndex = this._currentIndex;

      while (
        this._currentIndex < this._endIndex &&
        this._string[this._currentIndex] >= "0" &&
        this._string[this._currentIndex] <= "9"
      ) {
        this._currentIndex += 1; // Advance to first non-digit.
      }

      if (this._currentIndex !== startIntPartIndex) {
        var scanIntPartIndex = this._currentIndex - 1;
        var multiplier = 1;

        while (scanIntPartIndex >= startIntPartIndex) {
          integer += multiplier * (this._string[scanIntPartIndex] - "0");
          scanIntPartIndex -= 1;
          multiplier *= 10;
        }
      }

      // Read the decimals.
      if (this._currentIndex < this._endIndex && this._string[this._currentIndex] === ".") {
        this._currentIndex += 1;

        // There must be a least one digit following the .
        if (
          this._currentIndex >= this._endIndex ||
          this._string[this._currentIndex] < "0" ||
          this._string[this._currentIndex] > "9"
        ) {
          return null;
        }

        while (
          this._currentIndex < this._endIndex &&
          this._string[this._currentIndex] >= "0" &&
          this._string[this._currentIndex] <= "9"
        ) {
          frac *= 10;
          decimal += (this._string.charAt(this._currentIndex) - "0") / frac;
          this._currentIndex += 1;
        }
      }

      // Read the exponent part.
      if (
        this._currentIndex !== startIndex &&
        this._currentIndex + 1 < this._endIndex &&
        (this._string[this._currentIndex] === "e" || this._string[this._currentIndex] === "E") &&
        (this._string[this._currentIndex + 1] !== "x" && this._string[this._currentIndex + 1] !== "m")
      ) {
        this._currentIndex += 1;

        // Read the sign of the exponent.
        if (this._string[this._currentIndex] === "+") {
          this._currentIndex += 1;
        }
        else if (this._string[this._currentIndex] === "-") {
          this._currentIndex += 1;
          expsign = -1;
        }

        // There must be an exponent.
        if (
          this._currentIndex >= this._endIndex ||
          this._string[this._currentIndex] < "0" ||
          this._string[this._currentIndex] > "9"
        ) {
          return null;
        }

        while (
          this._currentIndex < this._endIndex &&
          this._string[this._currentIndex] >= "0" &&
          this._string[this._currentIndex] <= "9"
        ) {
          exponent *= 10;
          exponent += (this._string[this._currentIndex] - "0");
          this._currentIndex += 1;
        }
      }

      var number = integer + decimal;
      number *= sign;

      if (exponent) {
        number *= Math.pow(10, expsign * exponent);
      }

      if (startIndex === this._currentIndex) {
        return null;
      }

      this._skipOptionalSpacesOrDelimiter();

      return number;
    },

    _parseArcFlag: function() {
      if (this._currentIndex >= this._endIndex) {
        return null;
      }

      var flag = null;
      var flagChar = this._string[this._currentIndex];

      this._currentIndex += 1;

      if (flagChar === "0") {
        flag = 0;
      }
      else if (flagChar === "1") {
        flag = 1;
      }
      else {
        return null;
      }

      this._skipOptionalSpacesOrDelimiter();
      return flag;
    }
  };

  var parsePathDataString = function(string) {
    if (!string || string.length === 0) return [];

    var source = new Source(string);
    var pathData = [];

    if (source.initialCommandIsMoveTo()) {
      while (source.hasMoreData()) {
        var pathSeg = source.parseSegment();

        if (pathSeg === null) {
          break;
        }
        else {
          pathData.push(pathSeg);
        }
      }
    }

    return pathData;
  }

  // @info
  //   Get an array of corresponding cubic bezier curve parameters for given arc curve paramters.
  var arcToCubicCurves = function(x1, y1, x2, y2, r1, r2, angle, largeArcFlag, sweepFlag, _recursive) {
    var degToRad = function(degrees) {
      return (Math.PI * degrees) / 180;
    };

    var rotate = function(x, y, angleRad) {
      var X = x * Math.cos(angleRad) - y * Math.sin(angleRad);
      var Y = x * Math.sin(angleRad) + y * Math.cos(angleRad);
      return {x: X, y: Y};
    };

    var angleRad = degToRad(angle);
    var params = [];
    var f1, f2, cx, cy;

    if (_recursive) {
      f1 = _recursive[0];
      f2 = _recursive[1];
      cx = _recursive[2];
      cy = _recursive[3];
    }
    else {
      var p1 = rotate(x1, y1, -angleRad);
      x1 = p1.x;
      y1 = p1.y;

      var p2 = rotate(x2, y2, -angleRad);
      x2 = p2.x;
      y2 = p2.y;

      var x = (x1 - x2) / 2;
      var y = (y1 - y2) / 2;
      var h = (x * x) / (r1 * r1) + (y * y) / (r2 * r2);

      if (h > 1) {
        h = Math.sqrt(h);
        r1 = h * r1;
        r2 = h * r2;
      }

      var sign;

      if (largeArcFlag === sweepFlag) {
        sign = -1;
      }
      else {
        sign = 1;
      }

      var r1Pow = r1 * r1;
      var r2Pow = r2 * r2;

      var left = r1Pow * r2Pow - r1Pow * y * y - r2Pow * x * x;
      var right = r1Pow * y * y + r2Pow * x * x;

      var k = sign * Math.sqrt(Math.abs(left/right));

      cx = k * r1 * y / r2 + (x1 + x2) / 2;
      cy = k * -r2 * x / r1 + (y1 + y2) / 2;

      f1 = Math.asin(parseFloat(((y1 - cy) / r2).toFixed(9)));
      f2 = Math.asin(parseFloat(((y2 - cy) / r2).toFixed(9)));

      if (x1 < cx) {
        f1 = Math.PI - f1;
      }
      if (x2 < cx) {
        f2 = Math.PI - f2;
      }

      if (f1 < 0) {
        f1 = Math.PI * 2 + f1;
      }
      if (f2 < 0) {
        f2 = Math.PI * 2 + f2;
      }

      if (sweepFlag && f1 > f2) {
        f1 = f1 - Math.PI * 2;
      }
      if (!sweepFlag && f2 > f1) {
        f2 = f2 - Math.PI * 2;
      }
    }

    var df = f2 - f1;

    if (Math.abs(df) > (Math.PI * 120 / 180)) {
      var f2old = f2;
      var x2old = x2;
      var y2old = y2;

      if (sweepFlag && f2 > f1) {
        f2 = f1 + (Math.PI * 120 / 180) * (1);
      }
      else {
        f2 = f1 + (Math.PI * 120 / 180) * (-1);
      }

      x2 = cx + r1 * Math.cos(f2);
      y2 = cy + r2 * Math.sin(f2);
      params = arcToCubicCurves(x2, y2, x2old, y2old, r1, r2, angle, 0, sweepFlag, [f2, f2old, cx, cy]);
    }

    df = f2 - f1;

    var c1 = Math.cos(f1);
    var s1 = Math.sin(f1);
    var c2 = Math.cos(f2);
    var s2 = Math.sin(f2);
    var t = Math.tan(df / 4);
    var hx = 4 / 3 * r1 * t;
    var hy = 4 / 3 * r2 * t;

    var m1 = [x1, y1];
    var m2 = [x1 + hx * s1, y1 - hy * c1];
    var m3 = [x2 + hx * s2, y2 - hy * c2];
    var m4 = [x2, y2];

    m2[0] = 2 * m1[0] - m2[0];
    m2[1] = 2 * m1[1] - m2[1];

    if (_recursive) {
      return [m2, m3, m4].concat(params);
    }
    else {
      params = [m2, m3, m4].concat(params).join().split(",");

      var curves = [];
      var curveParams = [];

      params.forEach( function(param, i) {
        if (i % 2) {
          curveParams.push(rotate(params[i - 1], params[i], angleRad).y);
        }
        else {
          curveParams.push(rotate(params[i], params[i + 1], angleRad).x);
        }

        if (curveParams.length === 6) {
          curves.push(curveParams);
          curveParams = [];
        }
      });

      return curves;
    }
  };

  var clonePathData = function(pathData) {
    return pathData.map( function(seg) {
      return {type: seg.type, values: Array.prototype.slice.call(seg.values)}
    });
  };

  // @info
  //   Takes any path data, returns path data that consists only from absolute commands.
  var absolutizePathData = function(pathData) {
    var absolutizedPathData = [];

    var currentX = null;
    var currentY = null;

    var subpathX = null;
    var subpathY = null;

    pathData.forEach( function(seg) {
      var type = seg.type;

      if (type === "M") {
        var x = seg.values[0];
        var y = seg.values[1];

        absolutizedPathData.push({type: "M", values: [x, y]});

        subpathX = x;
        subpathY = y;

        currentX = x;
        currentY = y;
      }

      else if (type === "m") {
        var x = currentX + seg.values[0];
        var y = currentY + seg.values[1];

        absolutizedPathData.push({type: "M", values: [x, y]});

        subpathX = x;
        subpathY = y;

        currentX = x;
        currentY = y;
      }

      else if (type === "L") {
        var x = seg.values[0];
        var y = seg.values[1];

        absolutizedPathData.push({type: "L", values: [x, y]});

        currentX = x;
        currentY = y;
      }

      else if (type === "l") {
        var x = currentX + seg.values[0];
        var y = currentY + seg.values[1];

        absolutizedPathData.push({type: "L", values: [x, y]});

        currentX = x;
        currentY = y;
      }

      else if (type === "C") {
        var x1 = seg.values[0];
        var y1 = seg.values[1];
        var x2 = seg.values[2];
        var y2 = seg.values[3];
        var x = seg.values[4];
        var y = seg.values[5];

        absolutizedPathData.push({type: "C", values: [x1, y1, x2, y2, x, y]});

        currentX = x;
        currentY = y;
      }

      else if (type === "c") {
        var x1 = currentX + seg.values[0];
        var y1 = currentY + seg.values[1];
        var x2 = currentX + seg.values[2];
        var y2 = currentY + seg.values[3];
        var x = currentX + seg.values[4];
        var y = currentY + seg.values[5];

        absolutizedPathData.push({type: "C", values: [x1, y1, x2, y2, x, y]});

        currentX = x;
        currentY = y;
      }

      else if (type === "Q") {
        var x1 = seg.values[0];
        var y1 = seg.values[1];
        var x = seg.values[2];
        var y = seg.values[3];

        absolutizedPathData.push({type: "Q", values: [x1, y1, x, y]});

        currentX = x;
        currentY = y;
      }

      else if (type === "q") {
        var x1 = currentX + seg.values[0];
        var y1 = currentY + seg.values[1];
        var x = currentX + seg.values[2];
        var y = currentY + seg.values[3];

        absolutizedPathData.push({type: "Q", values: [x1, y1, x, y]});

        currentX = x;
        currentY = y;
      }

      else if (type === "A") {
        var x = seg.values[5];
        var y = seg.values[6];

        absolutizedPathData.push({
          type: "A",
          values: [seg.values[0], seg.values[1], seg.values[2], seg.values[3], seg.values[4], x, y]
        });

        currentX = x;
        currentY = y;
      }

      else if (type === "a") {
        var x = currentX + seg.values[5];
        var y = currentY + seg.values[6];

        absolutizedPathData.push({
          type: "A",
          values: [seg.values[0], seg.values[1], seg.values[2], seg.values[3], seg.values[4], x, y]
        });

        currentX = x;
        currentY = y;
      }

      else if (type === "H") {
        var x = seg.values[0];
        absolutizedPathData.push({type: "H", values: [x]});
        currentX = x;
      }

      else if (type === "h") {
        var x = currentX + seg.values[0];
        absolutizedPathData.push({type: "H", values: [x]});
        currentX = x;
      }

      else if (type === "V") {
        var y = seg.values[0];
        absolutizedPathData.push({type: "V", values: [y]});
        currentY = y;
      }

      else if (type === "v") {
        var y = currentY + seg.values[0];
        absolutizedPathData.push({type: "V", values: [y]});
        currentY = y;
      }

      else if (type === "S") {
        var x2 = seg.values[0];
        var y2 = seg.values[1];
        var x = seg.values[2];
        var y = seg.values[3];

        absolutizedPathData.push({type: "S", values: [x2, y2, x, y]});

        currentX = x;
        currentY = y;
      }

      else if (type === "s") {
        var x2 = currentX + seg.values[0];
        var y2 = currentY + seg.values[1];
        var x = currentX + seg.values[2];
        var y = currentY + seg.values[3];

        absolutizedPathData.push({type: "S", values: [x2, y2, x, y]});

        currentX = x;
        currentY = y;
      }

      else if (type === "T") {
        var x = seg.values[0];
        var y = seg.values[1]

        absolutizedPathData.push({type: "T", values: [x, y]});

        currentX = x;
        currentY = y;
      }

      else if (type === "t") {
        var x = currentX + seg.values[0];
        var y = currentY + seg.values[1]

        absolutizedPathData.push({type: "T", values: [x, y]});

        currentX = x;
        currentY = y;
      }

      else if (type === "Z" || type === "z") {
        absolutizedPathData.push({type: "Z", values: []});

        currentX = subpathX;
        currentY = subpathY;
      }
    });

    return absolutizedPathData;
  };

  // @info
  //   Takes path data that consists only from absolute commands, returns path data that consists only from
  //   "M", "L", "C" and "Z" commands.
  var reducePathData = function(pathData) {
    var reducedPathData = [];
    var lastType = null;

    var lastControlX = null;
    var lastControlY = null;

    var currentX = null;
    var currentY = null;

    var subpathX = null;
    var subpathY = null;

    pathData.forEach( function(seg) {
      if (seg.type === "M") {
        var x = seg.values[0];
        var y = seg.values[1];

        reducedPathData.push({type: "M", values: [x, y]});

        subpathX = x;
        subpathY = y;

        currentX = x;
        currentY = y;
      }

      else if (seg.type === "C") {
        var x1 = seg.values[0];
        var y1 = seg.values[1];
        var x2 = seg.values[2];
        var y2 = seg.values[3];
        var x = seg.values[4];
        var y = seg.values[5];

        reducedPathData.push({type: "C", values: [x1, y1, x2, y2, x, y]});

        lastControlX = x2;
        lastControlY = y2;

        currentX = x;
        currentY = y;
      }

      else if (seg.type === "L") {
        var x = seg.values[0];
        var y = seg.values[1];

        reducedPathData.push({type: "L", values: [x, y]});

        currentX = x;
        currentY = y;
      }

      else if (seg.type === "H") {
        var x = seg.values[0];

        reducedPathData.push({type: "L", values: [x, currentY]});

        currentX = x;
      }

      else if (seg.type === "V") {
        var y = seg.values[0];

        reducedPathData.push({type: "L", values: [currentX, y]});

        currentY = y;
      }

      else if (seg.type === "S") {
        var x2 = seg.values[0];
        var y2 = seg.values[1];
        var x = seg.values[2];
        var y = seg.values[3];

        var cx1, cy1;

        if (lastType === "C" || lastType === "S") {
          cx1 = currentX + (currentX - lastControlX);
          cy1 = currentY + (currentY - lastControlY);
        }
        else {
          cx1 = currentX;
          cy1 = currentY;
        }

        reducedPathData.push({type: "C", values: [cx1, cy1, x2, y2, x, y]});

        lastControlX = x2;
        lastControlY = y2;

        currentX = x;
        currentY = y;
      }

      else if (seg.type === "T") {
        var x = seg.values[0];
        var y = seg.values[1];

        var x1, y1;

        if (lastType === "Q" || lastType === "T") {
          x1 = currentX + (currentX - lastControlX);
          y1 = currentY + (currentY - lastControlY);
        }
        else {
          x1 = currentX;
          y1 = currentY;
        }

        var cx1 = currentX + 2 * (x1 - currentX) / 3;
        var cy1 = currentY + 2 * (y1 - currentY) / 3;
        var cx2 = x + 2 * (x1 - x) / 3;
        var cy2 = y + 2 * (y1 - y) / 3;

        reducedPathData.push({type: "C", values: [cx1, cy1, cx2, cy2, x, y]});

        lastControlX = x1;
        lastControlY = y1;

        currentX = x;
        currentY = y;
      }

      else if (seg.type === "Q") {
        var x1 = seg.values[0];
        var y1 = seg.values[1];
        var x = seg.values[2];
        var y = seg.values[3];

        var cx1 = currentX + 2 * (x1 - currentX) / 3;
        var cy1 = currentY + 2 * (y1 - currentY) / 3;
        var cx2 = x + 2 * (x1 - x) / 3;
        var cy2 = y + 2 * (y1 - y) / 3;

        reducedPathData.push({type: "C", values: [cx1, cy1, cx2, cy2, x, y]});

        lastControlX = x1;
        lastControlY = y1;

        currentX = x;
        currentY = y;
      }

      else if (seg.type === "A") {
        var r1 = seg.values[0];
        var r2 = seg.values[1];
        var angle = seg.values[2];
        var largeArcFlag = seg.values[3];
        var sweepFlag = seg.values[4];
        var x = seg.values[5];
        var y = seg.values[6];

        if (r1 === 0 || r2 === 0) {
          reducedPathData.push({type: "C", values: [currentX, currentY, x, y, x, y]});

          currentX = x;
          currentY = y;
        }
        else {
          if (currentX !== x || currentY !== y) {
            var curves = arcToCubicCurves(currentX, currentY, x, y, r1, r2, angle, largeArcFlag, sweepFlag);

            curves.forEach( function(curve) {
              reducedPathData.push({type: "C", values: curve});

              currentX = x;
              currentY = y;
            });
          }
        }
      }

      else if (seg.type === "Z") {
        reducedPathData.push(seg);

        currentX = subpathX;
        currentY = subpathY;
      }

      lastType = seg.type;
    });

    return reducedPathData;
  };

  var normalizedAbsPath = function(path) {
    var parsedData = parsePathDataString(path);
    return reducePathData(absolutizePathData(parsedData));
  };

  return {normalizedAbsPath: normalizedAbsPath};

})();


(function(SvgPathTools) {

  /*
  Copyright (c) 2016, Ruben Vermeersch
  Copyright (c) 2013, Kevin Lindsey
  All rights reserved.

  Redistribution and use in source and binary forms, with or without modification,
  are permitted provided that the following conditions are met:

    Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.

    Redistributions in binary form must reproduce the above copyright notice, this
    list of conditions and the following disclaimer in the documentation and/or
    other materials provided with the distribution.

    Neither the name of the {organization} nor the names of its
    contributors may be used to endorse or promote products derived from
    this software without specific prior written permission.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
  ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
  DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
  ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
  ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
  SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

  */

  var bezier3Type = "bezier3";
  var lineType = "line";

  var mathAbs = Math.abs;
  var mathAsin = Math.asin;
  var mathCos = Math.cos;
  var mathMax = Math.max;
  var mathMin = Math.min;
  var mathPi = Math.PI;
  var mathPow = Math.pow;
  var mathSin = Math.sin;
  var mathSqrt = Math.sqrt;
  var mathTan = Math.tan;

  var tolerance = 1e-6;

  function x(p) {
      return p[0];
  }

  function y(p) {
      return p[1];
  }

  function toFloat(v) {
      return parseFloat(v, 10);
  }

  function coordEqual(c1, c2) {
      return x(c1) === x(c2) && y(c1) === y(c2);
  }

  function coordMax(c1, c2) {
      return [mathMax(x(c1), x(c2)), mathMax(y(c1), y(c2))];
  }

  function coordMin(c1, c2) {
      return [mathMin(x(c1), x(c2)), mathMin(y(c1), y(c2))];
  }

  function coordMultiply(c, f) {
      return [x(c) * f, y(c) * f];
  }

  function coordAdd(c1, c2) {
      return [x(c1) + x(c2), y(c1) + y(c2)];
  }

  function coordDot(c1, c2) {
      return x(c1) * x(c2) + y(c1) * y(c2);
  }

  function coordLerp(c1, c2, t) {
      return [x(c1) + (x(c2) - x(c1)) * t, y(c1) + (y(c2) - y(c1)) * t];
  }

  function linearRoot(p2, p1) {
      var results = [];

      var a = p2;
      if (a !== 0) {
          results.push(-p1 / p2);
      }

      return results;
  }

  function quadRoots(p3, p2, p1) {
      var results = [];

      if (mathAbs(p3) <= tolerance) {
          return linearRoot(p2, p1);
      }

      var a = p3;
      var b = p2 / a;
      var c = p1 / a;
      var d = b * b - 4 * c;
      if (d > 0) {
          var e = mathSqrt(d);
          results.push(0.5 * (-b + e));
          results.push(0.5 * (-b - e));
      } else if (d === 0) {
          results.push(0.5 * -b);
      }

      return results;
  }

  function cubeRoots(p4, p3, p2, p1) {
      if (mathAbs(p4) <= tolerance) {
          return quadRoots(p3, p2, p1);
      }

      var results = [];

      var c3 = p4;
      var c2 = p3 / c3;
      var c1 = p2 / c3;
      var c0 = p1 / c3;

      var a = (3 * c1 - c2 * c2) / 3;
      var b = (2 * c2 * c2 * c2 - 9 * c1 * c2 + 27 * c0) / 27;
      var offset = c2 / 3;
      var discrim = b * b / 4 + a * a * a / 27;
      var halfB = b / 2;

      /* This should be here, but there's a typo in the original code (disrim =
       * 0) which causes it not to be present there. Ironically, adding the
       * following code breaks the algorithm, whereas leaving it out makes it
       * work correctly.
      if (mathAbs(discrim) <= tolerance) {
          discrim = 0;
      }
      */

      var tmp;
      if (discrim > 0) {
          var e = mathSqrt(discrim);
          tmp = -halfB + e;
          var root = tmp >= 0 ? mathPow(tmp, 1 / 3) : -mathPow(-tmp, 1 / 3);
          tmp = -halfB - e;
          if (tmp >= 0) {
              root += mathPow(tmp, 1 / 3);
          } else {
              root -= mathPow(-tmp, 1 / 3);
          }
          results.push(root - offset);
      } else if (discrim < 0) {
          var distance = mathSqrt(-a / 3);
          var angle = Math.atan2(mathSqrt(-discrim), -halfB) / 3;
          var cos = mathCos(angle);
          var sin = mathSin(angle);
          var sqrt3 = mathSqrt(3);
          results.push(2 * distance * cos - offset);
          results.push(-distance * (cos + sqrt3 * sin) - offset);
          results.push(-distance * (cos - sqrt3 * sin) - offset);
      } else {
          if (halfB >= 0)  {
              tmp = -mathPow(halfB, 1 / 3);
          } else {
              tmp = mathPow(-halfB, 1 / 3);
          }
          results.push(2 * tmp - offset);
          results.push(-tmp - offset);
      }

      return results;
  }

  function arcToCurve(cp1, rx, ry, angle, large_arc, sweep, cp2, recurse) {
      function rotate(cx, cy, r) {
          var cos = mathCos(r);
          var sin = mathSin(r);
          return [
              cx * cos - cy * sin,
              cx * sin + cy * cos,
          ];
      }

      var x1 = x(cp1);
      var y1 = y(cp1);
      var x2 = x(cp2);
      var y2 = y(cp2);

      var rad = mathPi / 180 * (+angle || 0);
      var f1 = 0;
      var f2 = 0;
      var cx;
      var cy;
      var res = [];

      if (!recurse) {
          var xy = rotate(x1, y1, -rad);
          x1 = x(xy);
          y1 = y(xy);
          xy = rotate(x2, y2, -rad);
          x2 = x(xy);
          y2 = y(xy);

          var px = (x1 - x2) / 2;
          var py = (y1 - y2) / 2;
          var h = (px * px) / (rx * rx) + (py * py) / (ry * ry);
          if (h > 1) {
              h = mathSqrt(h);
              rx = h * rx;
              ry = h * ry;
          }

          var rx2 = rx * rx;
          var ry2 = ry * ry;

          var k = (large_arc === sweep ? -1 : 1)
              * mathSqrt(mathAbs((rx2 * ry2 - rx2 * py * py - ry2 * px * px) / (rx2 * py * py + ry2 * px * px)));

          cx = k * rx * py / ry + (x1 + x2) / 2;
          cy = k * -ry * px / rx + (y1 + y2) / 2;
          f1 = mathAsin(((y1 - cy) / ry).toFixed(9));
          f2 = mathAsin(((y2 - cy) / ry).toFixed(9));

          f1 = x1 < cx ? mathPi - f1 : f1;
          f2 = x2 < cx ? mathPi - f2 : f2;

          if (f1 < 0) {
              f1 = mathPi * 2 + f1;
          }
          if (f2 < 0) {
              f2 = mathPi * 2 + f2;
          }
          if (sweep && f1 > f2) {
              f1 = f1 - mathPi * 2;
          }
          if (!sweep && f2 > f1) {
              f2 = f2 - mathPi * 2;
          }
      } else {
          f1 = recurse[0];
          f2 = recurse[1];
          cx = recurse[2];
          cy = recurse[3];
      }

      var df = f2 - f1;
      if (mathAbs(df) > mathPi * 120 / 180) {
          var f2old = f2;
          var x2old = x2;
          var y2old = y2;

          f2 = f1 + mathPi * 120 / 180 * (sweep && f2 > f1 ? 1 : -1);
          x2 = cx + rx * mathCos(f2);
          y2 = cy + ry * mathSin(f2);
          res = arcToCurve([x2, y2], rx, ry, angle, 0, sweep, [x2old, y2old], [f2, f2old, cx, cy]);
      }

      df = f2 - f1;

      var c1 = mathCos(f1);
      var s1 = mathSin(f1);
      var c2 = mathCos(f2);
      var s2 = mathSin(f2);
      var t = mathTan(df / 4);
      var hx = 4 / 3 * rx * t;
      var hy = 4 / 3 * ry * t;
      var m1 = [x1, y1];
      var m2 = [x1 + hx * s1, y1 - hy * c1];
      var m3 = [x2 + hx * s2, y2 - hy * c2];
      var m4 = [x2, y2];
      m2[0] = 2 * m1[0] - m2[0];
      m2[1] = 2 * m1[1] - m2[1];

      function splitCurves(curves) {
          var result = [];
          while (curves.length > 0) {
              result.push([
                  [curves[0], curves[1]],
                  [curves[2], curves[3]],
                  [curves[4], curves[5]],
              ]);
              curves.splice(0, 6);
          }
          return result;
      }

      if (recurse) {
          return splitCurves([m2, m3, m4].concat(res));
      } else {
          res = [m2, m3, m4].concat(res).join().split(",");
          var newres = [];
          for (var i = 0, ii = res.length; i < ii; i++) {
              newres[i] = i % 2 ? rotate(res[i - 1], res[i], rad)[1] : rotate(res[i], res[i + 1], rad)[0];
          }
          return splitCurves(newres);
      }
  }

  // Unpack an SVG path string into different curves and lines
  //
  // https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d
  function splitSegments(polygon) {
      if (typeof polygon !== "string") {
          throw new Error("Polygon should be a path string");
      }

      var start = null;
      var position = null;
      var result = [];

      function stripWhitespace() {
          polygon = polygon.trim();
      }

      function readCharSeq(n) {
          var c = polygon.charCodeAt(n);
          while (c >= 48 && c <= 57) {
              n++;
              c = polygon.charCodeAt(n);
          }
          return n;
      }

      function readNumber() {
          stripWhitespace();

          var start = 0;
          var end = 0;
          if (polygon[start] === ",") {
              start++;
              end++;
          }

          if (polygon[start] === "-") {
              end++;
          }

          end = readCharSeq(end);
          if (polygon[end] === ".") {
              end++;
              end = readCharSeq(end);
          }

          var s = polygon.substring(start, end);
          if (s !== "") {
              var num = toFloat(s);
              polygon = polygon.substring(end);
              if (polygon.length && polygon[0].toLowerCase() === "e") {
                  var f = 1;
                  var expEnd = 0;
                  if (polygon.length > 1 && polygon[1] === "-") {
                      f = -1;
                      expEnd = readCharSeq(2);
                  } else {
                      expEnd = readCharSeq(1);
                  }
                  var exp = toFloat(polygon.substring(1, expEnd));
                  if (mathAbs(exp) > 0) {
                      num *= mathPow(10, exp);
                  }
                  polygon = polygon.substring(expEnd);
              }
              return num;
          } else {
              throw new Error("Expected number: " + polygon);
          }
      }

      function readNumbers(n, fn) {
          stripWhitespace();
          var index = 0;
          var c = polygon.charCodeAt(0);
          while ((c >= 48 && c <= 57) || c === 44 || c === 45) {
              var numbers = [];
              for (var i = 0; i < n; i++) {
                  numbers.push(readNumber());
              }
              fn(numbers, index);

              stripWhitespace();
              c = polygon.charCodeAt(0);
              index++;
          }
      }

      function readCoords(n, fn) {
          readNumbers(n * 2, function (numbers, index) {
              var coords = [];
              for (var i = 0; i < n; i++) {
                  coords.push(numbers.splice(0, 2));
              }
              fn(coords, index);
          });
      }

      function pushType(itemType, offset) {
          return function (c) {
              if (offset) {
                  c = c.map(function (c) {
                      return [x(c) + x(offset), y(c) + y(offset)];
                  });
              }
              c.unshift(position);
              result.push({
                  type: itemType,
                  coords: c,
              });
              position = c[c.length - 1];
          };
      }

      function calculateBezierControlPoint() {
          var lastBezier = result[result.length - 1];
          var controlPoint = null;
          if (!lastBezier || lastBezier.type !== bezier3Type) {
              controlPoint = position;
          } else {
              // Calculate the mirror point of the last control point
              var lastPoint = lastBezier.coords[2];
              var xOffset = x(position) - x(lastPoint);
              var yOffset = y(position) - y(lastPoint);

              controlPoint = [x(position) + xOffset, y(position) + yOffset];
          }

          return controlPoint;
      }

      function handleArcSegment(relative) {
          readNumbers(7, function (numbers) {
              var c2 = coordAdd(numbers.slice(5, 7), relative);
              var args = [position].concat(numbers.slice(0, 5)).concat([c2]);
              var curve = arcToCurve.apply(null, args);
              for (var i = 0; i < curve.length; i++) {
                  pushType(bezier3Type)(curve[i]);
              }
          });
      }

      function readSegment() {
          stripWhitespace();
          if (polygon === "") {
              return;
          }

          var operator = polygon[0];
          polygon = polygon.substring(1);

          var pushLine = pushType(lineType);
          var origin = [0, 0];

          switch (operator) {
          case "M":
              readCoords(1, function (c, i) {
                  if (i === 0) {
                      position = c[0];
                      if (!start) {
                          start = position;
                      }
                  } else {
                      pushType(lineType)(c);
                  }
              });
              break;
          case "m":
              readCoords(1, function (c, i) {
                  if (i === 0) {
                      if (!position) {
                          position = c[0];
                      } else {
                          position = coordAdd(c, position);
                      }

                      if (!start) {
                          start = position;
                      }
                  } else {
                      var c0 = c[0];
                      pushType(lineType)([coordAdd(c0, position)]);
                  }
              });
              break;
          case "C":
              readCoords(3, pushType(bezier3Type));
              break;
          case "c":
              readCoords(3, pushType(bezier3Type, position));
              break;
          case "S":
              readCoords(2, function (coords) {
                  var controlPoint = calculateBezierControlPoint();
                  coords.unshift(controlPoint);
                  pushType(bezier3Type)(coords);
              });
              break;
          case "s":
              readCoords(2, function (coords) {
                  var controlPoint = calculateBezierControlPoint();
                  coords = coords.map(function (c) { return coordAdd(c, position); });
                  coords.unshift(controlPoint);
                  pushType(bezier3Type)(coords);
              });
              break;
          case "A":
              handleArcSegment(origin);
              break;
          case "a":
              handleArcSegment(position);
              break;
          case "L":
              readCoords(1, pushType(lineType));
              break;
          case "l":
              readCoords(1, function (c) {
                  pushLine([[x(c[0]) + x(position), y(c[0]) + y(position)]]);
              });
              break;
          case "H":
              pushType(lineType)([[readNumber(), y(position)]]);
              break;
          case "h":
              pushType(lineType, position)([[readNumber(), 0]]);
              break;
          case "V":
              pushType(lineType)([[x(position), readNumber()]]);
              break;
          case "v":
              pushType(lineType, position)([[0, readNumber()]]);
              break;
          case "Z":
          case "z":
              if (!coordEqual(position, start)) {
                  pushType(lineType)([start]);
              }
              break;
          default:
              throw new Error("Unknown operator: " + operator);
          } // jscs:ignore validateIndentation
          // ^ (jscs bug)
      }

      while (polygon.length > 0) {
          readSegment();
      }

      // Remove zero-length lines
      for (var i = 0; i < result.length; i++) {
          var segment = result[i];
          if (segment.type === lineType && coordEqual(segment.coords[0], segment.coords[1])) {
              result.splice(i, 1);
              i--;
          }
      }

      return result;
  }

  function intersectBezier3Line(p1, p2, p3, p4, a1, a2) {
      var result = [];

      var min = coordMin(a1, a2); // used to determine if point is on line segment
      var max = coordMax(a1, a2); // used to determine if point is on line segment

      // Start with Bezier using Bernstein polynomials for weighting functions:
      //     (1-t^3)P1 + 3t(1-t)^2P2 + 3t^2(1-t)P3 + t^3P4
      //
      // Expand and collect terms to form linear combinations of original Bezier
      // controls.  This ends up with a vector cubic in t:
      //     (-P1+3P2-3P3+P4)t^3 + (3P1-6P2+3P3)t^2 + (-3P1+3P2)t + P1
      //             /\                  /\                /\       /\
      //             ||                  ||                ||       ||
      //             c3                  c2                c1       c0

      // Calculate the coefficients
      var a = coordMultiply(p1, -1);
      var b = coordMultiply(p2, 3);
      var c = coordMultiply(p3, -3);
      var c3 = coordAdd(a, coordAdd(b, coordAdd(c, p4)));

      a = coordMultiply(p1, 3);
      b = coordMultiply(p2, -6);
      c = coordMultiply(p3, 3);
      var c2 = coordAdd(a, coordAdd(b, c));

      a = coordMultiply(p1, -3);
      b = coordMultiply(p2, 3);
      var c1 = coordAdd(a, b);

      var c0 = p1;

      // Convert line to normal form: ax + by + c = 0
      // Find normal to line: negative inverse of original line's slope
      var n = [y(a1) - y(a2), x(a2) - x(a1)];

      // Determine new c coefficient
      var cl = x(a1) * y(a2) - x(a2) * y(a1);

      // ?Rotate each cubic coefficient using line for new coordinate system?
      // Find roots of rotated cubic
      var roots = cubeRoots(
          coordDot(n, c3),
          coordDot(n, c2),
          coordDot(n, c1),
          coordDot(n, c0) + cl
      );

      // Any roots in closed interval [0,1] are intersections on Bezier, but
      // might not be on the line segment.
      // Find intersections and calculate point coordinates
      for (var i = 0; i < roots.length; i++) {
          var t = roots[i];

          if (t >= 0 && t <= 1) {
              // We're within the Bezier curve
              // Find point on Bezier
              var p5 = coordLerp(p1, p2, t);
              var p6 = coordLerp(p2, p3, t);
              var p7 = coordLerp(p3, p4, t);

              var p8 = coordLerp(p5, p6, t);
              var p9 = coordLerp(p6, p7, t);

              var p10 = coordLerp(p8, p9, t);

              // See if point is on line segment
              // Had to make special cases for vertical and horizontal lines due
              // to slight errors in calculation of p10
              if (x(a1) === x(a2)) {
                  if (y(min) <= y(p10) && y(p10) <= y(max)) {
                      result.push(p10);
                  }
              } else if (y(a1) === y(a2)) {
                  if (x(min) <= x(p10) && x(p10) <= x(max)) {
                      result.push(p10);
                  }
              } else if (x(min) <= x(p10) && x(p10) <= x(max) && y(min) <= y(p10) && y(p10) <= y(max)) {
                  result.push(p10);
              }
          }
      }

      return result;
  }

  function intersectLineLine(a1, a2, b1, b2) {
      var ua_t = (x(b2) - x(b1)) * (y(a1) - y(b1)) - (y(b2) - y(b1)) * (x(a1) - x(b1));
      var ub_t = (x(a2) - x(a1)) * (y(a1) - y(b1)) - (y(a2) - y(a1)) * (x(a1) - x(b1));
      var u_b  = (y(b2) - y(b1)) * (x(a2) - x(a1)) - (x(b2) - x(b1)) * (y(a2) - y(a1));

      if (u_b !== 0) {
          var ua = ua_t / u_b;
          var ub = ub_t / u_b;

          if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
              return [
                  [
                      x(a1) + ua * (x(a2) - x(a1)),
                      y(a1) + ua * (y(a2) - y(a1)),
                  ]
              ];
          }
      }

      return [];
  }

  function getIntersections(zero, point, shape) {
      var coords = shape.coords;
      switch (shape.type) {
      case bezier3Type:
          return intersectBezier3Line(coords[0], coords[1], coords[2], coords[3], zero, point);
      case lineType:
          return intersectLineLine(coords[0], coords[1], zero, point);
      default:
          throw new Error("Unsupported shape type: " + shape.type);
      } // jscs:ignore validateIndentation
      // ^ (jscs bug)
  }

  function isInside(point, polygon) {
      var segments;
      if (polygon && Array.isArray(polygon)) {
          segments = polygon;
      } else {
          segments = splitSegments(polygon);
      }

      var minX = 0;
      var minY = 0;
      for (var s = 0; s < segments.length; s++) {
          var coords = segments[s].coords;
          for (var c = 0; c < coords.length; c++) {
              var coord = coords[c];
              minX = Math.min(minX, x(coord));
              minY = Math.min(minY, y(coord));
          }
      }
      var zero = [minX - 10, minY - 10];

      var intersections = [];
      for (var i = 0; i < segments.length; i++) {
          var newIntersections = getIntersections(zero, point, segments[i]);
          for (var j = 0; j < newIntersections.length; j++) {
              var seen = false;
              var intersection = newIntersections[j];

              for (var k = 0; k < intersections.length; k++) {
                  if (coordEqual(intersections[k], intersection)) {
                      seen = true;
                      break;
                  }
              }

              if (!seen) {
                  intersections.push(intersection);
              }
          }
      }

      return intersections.length % 2 === 1;
  };

  SvgPathTools.isInside = isInside;
  SvgPathTools.splitSegments = splitSegments;

})(SvgPathTools);
