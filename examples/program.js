function foo(point) {
    if (point.x > 2)
        return point.x * 2;
    return point.y;
}

function length(linkedList) {
    if (!linkedList) return 0;
    1 + length(linkedList.next);
}

function isLong(linkedList) {
    return length(linkedList) > 5;
}

function distance(points) {
    const a = points.a;
    const b = points.b;
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}
