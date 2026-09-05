module width_mismatch (
    input  wire [3:0] in_a,
    input  wire [7:0] in_b,
    output reg  [3:0] out_val
);

    always @* begin
        // Flaw: Truncation from 8 bits to 4 bits
        out_val = in_b;
    end

endmodule
