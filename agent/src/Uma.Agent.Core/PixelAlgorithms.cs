namespace Uma.Agent.Core;

public static class PixelAlgorithms
{
    public static string DHash(Frame image, LayoutCrop? crop=null){
        var c=crop??new LayoutCrop(0,0,1000,1000); int x0=c.X0*image.Width/1000; int x1=c.X1*image.Width/1000; int y0=c.Y0*image.Height/1000; int y1=c.Y1*image.Height/1000; int w=x1-x0; int h=y1-y0;
        if(w<9||h<8)throw new ArgumentException("dHash crop must be at least 9x8");
        var sums=new long[8,9];var counts=new long[8,9];
        for(int y=0;y<h;y++){int j=((y+1)*8-1)/h;for(int x=0;x<w;x++){int i=((x+1)*9-1)/w;int p=((y0+y)*image.Width+x0+x)*4;int a=image.Bgra[p+3];int b=Flat(image.Bgra[p],a); int g=Flat(image.Bgra[p+1],a); int r=Flat(image.Bgra[p+2],a);sums[j,i]+=299L*r+587L*g+114L*b;counts[j,i]++;}}
        ulong bits=0;for(int j=0;j<8;j++)for(int i=0;i<8;i++){bits<<=1;if(sums[j,i]*counts[j,i+1]>sums[j,i+1]*counts[j,i])bits|=1;}
        return bits.ToString("x16");
    }
    private static int Flat(int c,int a)=>(c*a+255*(255-a)+127)/255;
    public static int Hamming(string a,string b){if(a.Length!=b.Length)throw new ArgumentException();uint d=0;for(int i=0;i<a.Length;i++)d+=(uint)System.Numerics.BitOperations.PopCount((uint)(Convert.ToInt32(a[i].ToString(),16)^Convert.ToInt32(b[i].ToString(),16)));return (int)d;}
    public static int CountSparkStars(Frame image,int x,int y,int width=60,int height=18){var filled=0;for(int cell=0;cell<3;cell++){int gold=0; int total=0;for(int yy=y;yy<y+height;yy++)for(int xx=x+cell*width/3;xx<x+(cell+1)*width/3;xx++){int p=(yy*image.Width+xx)*4; int b=image.Bgra[p]; int g=image.Bgra[p+1]; int r=image.Bgra[p+2];gold+=r>200&&g>150&&b<90&&r-b>130?1:0;total++;}if((double)gold/total>.15)filled++;}return filled;}
    public static bool IsLimitBreakFilled(Frame image,int cx,int cy){var yes=0;for(int y=cy-2;y<=cy+2;y++)for(int x=cx-2;x<=cx+2;x++){int p=(y*image.Width+x)*4; int b=image.Bgra[p]; int g=image.Bgra[p+1]; int r=image.Bgra[p+2];if(b-r>60&&g>140)yes++;}return yes>12;}
}
public readonly record struct LayoutCrop(int X0,int Y0,int X1,int Y1);
public static class LayoutProfiles
{
 public const string Version="global-2026-09";
 public static readonly LayoutCrop CardArtCrop=new(100,340,900,780);
 public static readonly LayoutCrop CharIconCrop=new(180,150,820,750);
 public static readonly LayoutCrop VeteranIconCrop=new(220,150,780,700);
 public const int ReferenceWidth=1920,ReferenceHeight=1080;
 public static Rect Scale(Rect roi,int width,int height){if(width*9!=height*16)throw new ArgumentException("unsupported aspect ratio");return new Rect(roi.X*width/ReferenceWidth,roi.Y*height/ReferenceHeight,roi.Width*width/ReferenceWidth,roi.Height*height/ReferenceHeight);}
}
